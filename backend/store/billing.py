"""
Rent calculation.

Every 'out' challan line starts a *lot* (qty pieces of one item, given to one
site at a time, at an agreed rent). Returns use up the oldest lots of that item
at that site first (FIFO). That splits the history into *pieces*:

    qty, item, site, start (given at), end (returned at, or None = still out), rent

Pieces reported lost end just like returned ones (rent stops then); their price
is charged once, on the bill whose period contains the challan.

A replacement is just "return item2" + "give item3" in the same challan, so
item2 is charged until the swap and item3 from the swap onwards — each at its
own rent.

Billing is cumulative so that bills made in between (e.g. monthly) never
double-charge a day:

    charge now = qty x rate x (units(start -> min(end, bill_upto))
                               - units already charged up to the previous bill)
"""

import math
from collections import deque
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from .models import Bill, ChallanLine, ShopSettings

GST_TYPES = ("none", "intra", "inter")

CENT = Decimal("0.01")


def q2(value) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def human_at(dt) -> str:
    return timezone.localtime(dt).strftime("%d-%m-%Y %I:%M %p")


def rent_units(basis: str, start, end, day_mode: str, grace_hours) -> int:
    """How many days/hours to charge for material out from start to end (min 1)."""
    start = timezone.localtime(start)
    end = timezone.localtime(end)
    seconds = max(0.0, (end - start).total_seconds())

    if basis == "hour":
        return max(1, math.ceil(seconds / 3600 - 1e-9))  # every started hour

    if day_mode == "inclusive":
        return max(1, (end.date() - start.date()).days + 1)

    if day_mode == "24h":
        hours = seconds / 3600
        full_days = int(hours // 24)
        extra_hours = hours - full_days * 24
        return max(1, full_days + (1 if extra_hours > float(grace_hours or 0) + 1e-9 else 0))

    # "calendar": date difference; same-day return = 1 day
    return max(1, (end.date() - start.date()).days)


class LedgerError(Exception):
    pass


def build_ledger(customer_id, strict=True):
    """Return the customer's rental pieces (see module docstring)."""
    lines = list(
        ChallanLine.objects.filter(challan__customer_id=customer_id).select_related(
            "challan", "challan__site", "item"
        )
    )
    # Time order; inside one challan, 'out' before 'in'.
    lines.sort(key=lambda l: (l.challan.at, l.challan_id, 0 if l.direction == "out" else 1, l.id))

    lots = {}
    pieces = []
    for line in lines:
        item = line.item
        site = line.challan.site
        queue = lots.setdefault((item.id, line.challan.site_id), deque())
        if line.direction == "out":
            queue.append(
                {
                    "item_id": item.id,
                    "item_name": item.name,
                    "unit": item.unit,
                    "site_id": line.challan.site_id,
                    "site_name": site.name if site else "",
                    "qty": line.qty,
                    "start": line.challan.at,
                    "rate": line.rate if line.rate is not None else item.rate,
                    "basis": line.basis or item.basis,
                    "challan_id": line.challan_id,
                    "lost": False,
                }
            )
            continue

        need = line.qty
        have = sum(lot["qty"] for lot in queue)
        if have < need and strict:
            where = f" at site {site.name}" if site else ""
            what = "reported lost" if line.lost else "returned"
            raise LedgerError(
                f"{item.name}: the customer had only {have} {item.unit}{where} on "
                f"{human_at(line.challan.at)}, so {need} cannot be {what}."
            )
        while need > 0 and queue:
            lot = queue[0]
            take = min(need, lot["qty"])
            pieces.append({**lot, "qty": take, "end": line.challan.at, "lost": line.lost})
            lot["qty"] -= take
            need -= take
            if lot["qty"] == 0:
                queue.popleft()

    for queue in lots.values():
        for lot in queue:
            pieces.append({**lot, "end": None})
    return pieces


def holdings_from(pieces):
    """Items currently with the customer, grouped by site and item."""
    by_item = {}
    for p in pieces:
        if p["end"] is not None:
            continue
        h = by_item.setdefault(
            (p["site_id"], p["item_id"]),
            {
                "item_id": p["item_id"],
                "item_name": p["item_name"],
                "unit": p["unit"],
                "site_id": p["site_id"],
                "site_name": p["site_name"],
                "qty": 0,
                "lots": [],
            },
        )
        h["qty"] += p["qty"]
        h["lots"].append({"at": p["start"], "qty": p["qty"], "rate": p["rate"], "basis": p["basis"]})
    return sorted(by_item.values(), key=lambda h: (h["site_name"].lower(), h["item_name"].lower()))


def last_bill(customer_id):
    return Bill.objects.filter(customer_id=customer_id).order_by("-upto_at", "-id").first()


def rent_preview(customer_id, upto, shop=None, pieces=None):
    """Rent not yet billed for this customer, counted up to `upto`."""
    shop = shop or ShopSettings.load()
    prev = last_bill(customer_id)
    prev_upto = prev.upto_at if prev else None
    if pieces is None:
        pieces = build_ledger(customer_id, strict=False)

    merged = {}
    for p in pieces:
        start, end = p["start"], p["end"]
        if start > upto:
            continue
        returned = end is not None and end <= upto
        status = ("lost" if p["lost"] else "returned") if returned else "out"
        end_now = end if returned else upto
        units_now = rent_units(p["basis"], start, end_now, shop.day_mode, shop.grace_hours)

        units_before = 0
        if prev_upto is not None and start <= prev_upto:
            end_prev = end if (end is not None and end <= prev_upto) else prev_upto
            units_before = rent_units(p["basis"], start, end_prev, prev.day_mode, prev.grace_hours)

        units = units_now - units_before
        if units <= 0:
            continue
        key = (p["site_id"], p["item_id"], start, end_now, status, p["rate"], p["basis"], units_before, units)
        if key in merged:
            merged[key]["qty"] += p["qty"]
        else:
            merged[key] = {
                "item_id": p["item_id"],
                "item_name": p["item_name"],
                "unit": p["unit"],
                "site_name": p["site_name"],
                "qty": p["qty"],
                "from_at": start,
                "to_at": end_now,
                "status": status,
                "units": units,
                "prev_units": units_before,
                "basis": p["basis"],
                "rate": p["rate"],
            }

    lines = sorted(
        merged.values(), key=lambda l: (l["site_name"].lower(), l["from_at"], l["item_name"].lower(), l["to_at"])
    )
    total = Decimal("0")
    for line in lines:
        line["amount"] = q2(Decimal(line["qty"]) * Decimal(line["rate"]) * line["units"])
        total += line["amount"]

    lost_lines = lost_in_period(customer_id, prev_upto, upto)

    return {
        "from_at": prev_upto,
        "upto_at": upto,
        "last_bill_no": prev.bill_no if prev else None,
        "lines": lines,
        "rent_total": q2(total),
        "lost_lines": lost_lines,
        "lost_total": q2(sum((l["amount"] for l in lost_lines), Decimal(0))),
        "day_mode": shop.day_mode,
        "grace_hours": shop.grace_hours,
    }


def lost_in_period(customer_id, after, upto):
    """Pieces reported lost after the previous bill and up to `upto`: charged once."""
    qs = ChallanLine.objects.filter(
        challan__customer_id=customer_id, direction="in", lost=True, challan__at__lte=upto
    ).select_related("challan", "challan__site", "item")
    if after is not None:
        qs = qs.filter(challan__at__gt=after)
    rows = []
    for l in qs.order_by("challan__at", "id"):
        rate = l.rate if l.rate is not None else l.item.lost_rate
        rows.append(
            {
                "item_id": l.item_id,
                "item_name": l.item.name,
                "unit": l.item.unit,
                "site_name": l.challan.site.name if l.challan.site_id else "",
                "qty": l.qty,
                "at": l.challan.at,
                "challan_id": l.challan_id,
                "rate": rate,
                "amount": q2(Decimal(l.qty) * Decimal(rate)),
            }
        )
    return rows


# --------------------------------------------------------------------------- GST


def gst_state(gstin):
    """First two digits of a GSTIN are the state code."""
    gstin = (gstin or "").strip()
    return gstin[:2] if len(gstin) >= 2 and gstin[:2].isdigit() else ""


def default_gst_type(shop, customer):
    if not shop.gst_enabled:
        return "none"
    mine, theirs = gst_state(shop.gstin), gst_state(customer.gstin)
    return "inter" if mine and theirs and mine != theirs else "intra"


def gst_amounts(taxable, gst_type, rate):
    """-> (cgst, sgst, igst). CGST and SGST are half the rate each."""
    taxable, rate = Decimal(taxable), Decimal(rate)
    if gst_type == "intra":
        half = q2(taxable * rate / 2 / 100)
        return half, half, Decimal("0.00")
    if gst_type == "inter":
        return Decimal("0.00"), Decimal("0.00"), q2(taxable * rate / 100)
    return Decimal("0.00"), Decimal("0.00"), Decimal("0.00")
