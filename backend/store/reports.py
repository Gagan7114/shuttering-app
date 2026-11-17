"""Reports: money due, daily, monthly, who has the stock, GST sales register."""

import csv
import io
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Case, F, IntegerField, Max, Sum, When
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .billing import build_ledger, gst_state, q2, rent_preview
from .models import Bill, Challan, ChallanLine, Customer, Item, Payment, ShopSettings
from .views import ApiError, at_str, challan_json, challan_queryset, day_start, last_upto_by_customer, parse_day, to_int

ZERO = Decimal("0")


def local_day(dt):
    return timezone.localtime(dt).date()


def month_range(value):
    """'YYYY-MM' -> (first day, first day of next month)."""
    try:
        y, m = (int(x) for x in str(value).split("-")[:2])
        first = date(y, m, 1)
    except (TypeError, ValueError):
        raise ApiError("Month must look like 2026-11.")
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return first, nxt


def missing_bill_numbers():
    """Bill numbers skipped between 1 and the highest bill number."""
    nos = set(Bill.objects.values_list("bill_no", flat=True))
    if not nos:
        return []
    return [n for n in range(1, max(nos) + 1) if n not in nos]


# --------------------------------------------------------------------------- money due


@api_view(["GET"])
def outstanding_view(request):
    now = timezone.now()
    shop = ShopSettings.load()
    billed = {r["customer_id"]: r for r in Bill.objects.values("customer_id").annotate(s=Sum("total"), last=Max("upto_at"))}
    paid = {
        r["customer_id"]: r
        for r in Payment.objects.values("customer_id").annotate(a=Sum("amount"), t=Sum("tds"), last=Max("date"))
    }
    out = {
        r["challan__customer_id"]: r["n"] or 0
        for r in ChallanLine.objects.values("challan__customer_id").annotate(
            n=Sum(Case(When(direction="out", then=F("qty")), default=-F("qty"), output_field=IntegerField()))
        )
    }
    rows = []
    for c in Customer.objects.all():
        b, p = billed.get(c.id, {}), paid.get(c.id, {})
        total_billed = b.get("s") or ZERO
        received, tds = p.get("a") or ZERO, p.get("t") or ZERO
        pcs = out.get(c.id, 0)
        running = ZERO
        if pcs or c.id in out:
            running = rent_preview(c.id, now, shop, build_ledger(c.id, strict=False))["rent_total"]
        balance = total_billed - received - tds
        if not (balance or pcs or running):
            continue
        rows.append(
            {
                "customer_id": c.id,
                "name": c.name,
                "phone": c.phone,
                "pcs_out": pcs,
                "billed": total_billed,
                "received": received,
                "tds": tds,
                "balance": balance,
                "running_rent": running,
                "last_bill": at_str(b.get("last")),
                "last_payment": p["last"].isoformat() if p.get("last") else None,
            }
        )
    rows.sort(key=lambda r: (-r["balance"], r["name"].lower()))
    return Response(
        {
            "rows": rows,
            "total_balance": sum((r["balance"] for r in rows), ZERO),
            "total_running": q2(sum((r["running_rent"] for r in rows), ZERO)),
        }
    )


# --------------------------------------------------------------------------- daily


@api_view(["GET"])
def daily_view(request):
    day = parse_day(request.query_params.get("date")) or timezone.localdate()
    start, end = day_start(day), day_start(day + timedelta(days=1))

    locks = last_upto_by_customer()
    challans = list(challan_queryset().filter(at__gte=start, at__lt=end).order_by("at", "id"))
    moves = {}
    for ch in challans:
        for l in ch.lines.all():
            m = moves.setdefault(l.item_id, {"item_name": l.item.name, "unit": l.item.unit, "given": 0, "back": 0, "lost": 0})
            m["lost" if l.lost else ("given" if l.direction == "out" else "back")] += l.qty

    bills = Bill.objects.select_related("customer").filter(upto_at__gte=start, upto_at__lt=end).order_by("bill_no")
    payments = Payment.objects.select_related("customer").filter(date=day).order_by("id")
    return Response(
        {
            "date": day.isoformat(),
            "challans": [challan_json(ch, locks.get(ch.customer_id)) for ch in challans],
            "moves": sorted(moves.values(), key=lambda m: m["item_name"].lower()),
            "bills": [
                {"id": b.id, "bill_no": b.bill_no, "customer_name": b.customer.name, "total": b.total} for b in bills
            ],
            "payments": [
                {
                    "id": p.id,
                    "customer_id": p.customer_id,
                    "customer_name": p.customer.name,
                    "amount": p.amount,
                    "tds": p.tds,
                    "mode": p.mode,
                    "note": p.note,
                }
                for p in payments
            ],
            "billed": sum((b.total for b in bills), ZERO),
            "received": sum((p.amount for p in payments), ZERO),
            "tds": sum((p.tds for p in payments), ZERO),
        }
    )


# --------------------------------------------------------------------------- monthly


@api_view(["GET"])
def monthly_view(request):
    year = to_int(request.query_params.get("year") or timezone.localdate().year, "Year", 2000)
    start, end = day_start(date(year, 1, 1)), day_start(date(year + 1, 1, 1))
    keys = ["bills", "rent", "lost", "extras", "discount", "taxable", "gst", "billed", "received", "tds"]
    months = [{"month": f"{year}-{m:02d}", **{k: (0 if k == "bills" else ZERO) for k in keys}} for m in range(1, 13)]

    for b in Bill.objects.filter(upto_at__gte=start, upto_at__lt=end):
        row = months[local_day(b.upto_at).month - 1]
        row["bills"] += 1
        row["rent"] += b.rent_total
        row["lost"] += b.lost_total
        row["extras"] += b.extras_total
        row["discount"] += b.discount
        row["taxable"] += b.taxable
        row["gst"] += b.cgst + b.sgst + b.igst
        row["billed"] += b.total
    for p in Payment.objects.filter(date__year=year):
        row = months[p.date.month - 1]
        row["received"] += p.amount
        row["tds"] += p.tds

    totals = {k: sum((m[k] for m in months), 0 if k == "bills" else ZERO) for k in keys}
    return Response({"year": year, "months": months, "totals": totals})


# --------------------------------------------------------------------------- who has the stock


@api_view(["GET"])
def stock_view(request):
    net = (
        ChallanLine.objects.values(
            "item_id", "challan__customer_id", "challan__customer__name", "challan__site__name"
        )
        .annotate(n=Sum(Case(When(direction="out", then=F("qty")), default=-F("qty"), output_field=IntegerField())))
        .filter(n__gt=0)
    )
    holders = {}
    for r in net:
        holders.setdefault(r["item_id"], []).append(
            {
                "customer_id": r["challan__customer_id"],
                "customer_name": r["challan__customer__name"],
                "site_name": r["challan__site__name"] or "",
                "qty": r["n"],
            }
        )
    lost = {
        r["item_id"]: r["n"] for r in ChallanLine.objects.filter(lost=True).values("item_id").annotate(n=Sum("qty"))
    }
    rows = []
    for i in Item.objects.all():
        hs = sorted(holders.get(i.id, []), key=lambda h: (-h["qty"], h["customer_name"].lower()))
        out = sum(h["qty"] for h in hs)
        rows.append(
            {
                "item_id": i.id,
                "item_name": i.name,
                "category": i.category,
                "unit": i.unit,
                "total_qty": i.total_qty,
                "in_store": i.total_qty - out,
                "out_qty": out,
                "lost_qty": lost.get(i.id, 0),
                "holders": hs,
            }
        )
    return Response({"rows": rows})


# --------------------------------------------------------------------------- GST sales register


@api_view(["GET"])
def gst_view(request):
    first, nxt = month_range(request.query_params.get("month") or timezone.localdate().strftime("%Y-%m"))
    shop = ShopSettings.load()
    bills = Bill.objects.select_related("customer").filter(upto_at__gte=day_start(first), upto_at__lt=day_start(nxt))
    rows = []
    for b in bills.order_by("bill_no"):
        rows.append(
            {
                "id": b.id,
                "bill_no": b.bill_no,
                "date": local_day(b.upto_at).isoformat(),
                "customer_name": b.customer.name,
                "gstin": b.customer_gstin,
                "type": "B2B" if b.customer_gstin else "B2C",
                "place": gst_state(b.customer_gstin) or gst_state(shop.gstin),
                "gst_type": b.gst_type,
                "gst_rate": b.gst_rate,
                "taxable": b.taxable,
                "cgst": b.cgst,
                "sgst": b.sgst,
                "igst": b.igst,
                "total": b.total,
            }
        )

    def add(group, r):
        for k in ("taxable", "cgst", "sgst", "igst", "total"):
            group[k] = group.get(k, ZERO) + r[k]
        group["bills"] = group.get("bills", 0) + 1

    summary = {"B2B": {}, "B2C": {}, "all": {}}
    for r in rows:
        add(summary[r["type"]], r)
        add(summary["all"], r)

    if request.query_params.get("download") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Bill no", "Date", "Customer", "GSTIN", "B2B/B2C", "Place (state code)", "GST %",
                    "Taxable", "CGST", "SGST", "IGST", "Bill total"])
        for r in rows:
            w.writerow([r["bill_no"], r["date"], r["customer_name"], r["gstin"], r["type"], r["place"],
                        r["gst_rate"], r["taxable"], r["cgst"], r["sgst"], r["igst"], r["total"]])
        resp = HttpResponse(buf.getvalue(), content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="gst-sales-{first:%Y-%m}.csv"'
        return resp

    return Response(
        {
            "month": first.strftime("%Y-%m"),
            "shop_gstin": shop.gstin,
            "sac_code": shop.sac_code,
            "rows": rows,
            "summary": summary,
            "missing_bill_nos": missing_bill_numbers(),
        }
    )
