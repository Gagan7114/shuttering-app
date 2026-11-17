from datetime import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .billing import rent_units
from .models import Bill, Customer, Item, ShopSettings


def at(s):
    return timezone.make_aware(datetime.fromisoformat(s))


class RentUnitsTests(TestCase):
    def test_calendar_mode(self):
        self.assertEqual(rent_units("day", at("2026-11-01T10:00"), at("2026-11-03T18:00"), "calendar", 0), 2)
        self.assertEqual(rent_units("day", at("2026-11-01T10:00"), at("2026-11-01T18:00"), "calendar", 0), 1)

    def test_inclusive_mode(self):
        self.assertEqual(rent_units("day", at("2026-11-01T10:00"), at("2026-11-03T09:00"), "inclusive", 0), 3)

    def test_24h_mode_with_grace(self):
        self.assertEqual(rent_units("day", at("2026-11-01T10:00"), at("2026-11-03T11:30"), "24h", 2), 2)
        self.assertEqual(rent_units("day", at("2026-11-01T10:00"), at("2026-11-03T12:30"), "24h", 2), 3)

    def test_hours(self):
        self.assertEqual(rent_units("hour", at("2026-11-01T10:00"), at("2026-11-01T10:20"), "calendar", 0), 1)
        self.assertEqual(rent_units("hour", at("2026-11-01T10:00"), at("2026-11-01T13:01"), "calendar", 0), 4)


class FlowBase(TestCase):
    """Shop with a few items and one customer, plus helpers."""

    def setUp(self):
        self.user = get_user_model().objects.create_user("owner", password="secret123")
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        ShopSettings.load()  # default: calendar days
        self.item1 = Item.objects.create(name="Plate 3x2", total_qty=100, rate=Decimal("5"), basis="day")
        self.item2 = Item.objects.create(name="Prop 10ft", total_qty=50, rate=Decimal("3"), basis="day")
        self.item3 = Item.objects.create(name="Prop 12ft", total_qty=50, rate=Decimal("4"), basis="day")
        self.mixer = Item.objects.create(name="Mixer", total_qty=2, rate=Decimal("150"), basis="hour")
        self.cust = Customer.objects.create(name="Customer A")

    def challan(self, when, *lines, expect=201):
        res = self.api.post(
            "/api/challans", {"customer_id": self.cust.id, "at": when, "lines": list(lines)}, format="json"
        )
        self.assertEqual(res.status_code, expect, res.data)
        return res.data

    @staticmethod
    def give(item, qty, **kw):
        return {"item_id": item.id, "direction": "out", "qty": qty, **kw}

    @staticmethod
    def back(item, qty):
        return {"item_id": item.id, "direction": "in", "qty": qty}

    def items(self):
        return {i["name"]: i for i in self.api.get("/api/items").data}


class FlowTests(FlowBase):
    def test_users_example_return_and_replace(self):
        # Day 0: customer A takes item1 x3 and item2 x4
        self.challan("2026-11-01T10:00", self.give(self.item1, 3), self.give(self.item2, 4))
        self.assertEqual(self.items()["Plate 3x2"]["available"], 97)
        self.assertEqual(self.items()["Prop 10ft"]["available"], 46)

        # Day 2: returns all item1; of the 4 item2 -> 2 returned, 2 replaced by item3
        ch = self.challan(
            "2026-11-03T10:00",
            self.back(self.item1, 3),
            self.back(self.item2, 4),
            self.give(self.item3, 2, replaces_item_id=self.item2.id),
        )
        self.assertEqual(ch["kind"], "swap")
        stock = self.items()
        self.assertEqual(stock["Plate 3x2"]["available"], 100)
        self.assertEqual(stock["Prop 10ft"]["available"], 50)
        self.assertEqual(stock["Prop 12ft"]["available"], 48)

        # Day 5: item3 comes back; bill everything
        self.challan("2026-11-05T09:00", self.back(self.item3, 2))
        pv = self.api.get(f"/api/customers/{self.cust.id}/preview", {"at": "2026-11-05T18:00"}).data
        got = sorted((l["item_name"], l["qty"], l["units"], l["amount"]) for l in pv["lines"])
        self.assertEqual(
            got,
            [
                ("Plate 3x2", 3, 2, 30.0),  # 3 x 2 days x 5
                ("Prop 10ft", 4, 2, 24.0),  # 4 x 2 days x 3
                ("Prop 12ft", 2, 2, 16.0),  # 2 x 2 days x 4 (from the swap)
            ],
        )
        self.assertEqual(pv["rent_total"], 70.0)

        res = self.api.post(
            "/api/bills",
            {"customer_id": self.cust.id, "upto": "2026-11-05T18:00", "extras": [{"description": "Transport", "amount": 200}], "discount": 20},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        bill = self.api.get(f"/api/bills/{res.data['id']}").data
        self.assertEqual(bill["total"], 250.0)

    def test_take_return_take_more_return_all_is_one_bill(self):
        faata = Item.objects.create(name="Faata", total_qty=20, rate=Decimal("2"), basis="day")
        # Day 0: 5 steel plates + 10 faate
        self.challan("2026-11-01T10:00", self.give(self.item1, 5), self.give(faata, 10))
        # Day 2: steel plates come back; faate still out, so no bill is suggested yet
        ch = self.challan("2026-11-03T10:00", self.back(self.item1, 5))
        self.assertEqual(self.api.get(f"/api/challans/{ch['id']}").data["customer_pcs_out"], 10)
        # 3 days later: takes other items
        self.challan("2026-11-06T10:00", self.give(self.item3, 4))
        # a week later: everything comes back
        ch = self.challan("2026-11-13T10:00", self.back(faata, 10), self.back(self.item3, 4))
        self.assertEqual(self.api.get(f"/api/challans/{ch['id']}").data["customer_pcs_out"], 0)

        res = self.api.post("/api/bills", {"customer_id": self.cust.id, "upto": "2026-11-13T18:00"}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        bill = self.api.get(f"/api/bills/{res.data['id']}").data
        got = sorted((l["item_name"], l["qty"], l["units"], l["amount"]) for l in bill["lines"])
        self.assertEqual(
            got,
            [
                ("Faata", 10, 12, 240.0),  # 10 x 12 days x 2
                ("Plate 3x2", 5, 2, 50.0),  # 5 x 2 days x 5
                ("Prop 12ft", 4, 7, 112.0),  # 4 x 7 days x 4
            ],
        )
        self.assertEqual(bill["total"], 402.0)
        self.assertEqual(Bill.objects.filter(customer=self.cust).count(), 1)

    def test_monthly_bills_do_not_double_charge(self):
        self.challan("2026-10-01T10:00", self.give(self.item1, 10))
        r1 = self.api.post("/api/bills", {"customer_id": self.cust.id, "upto": "2026-10-31T20:00"}, format="json")
        self.assertEqual(r1.status_code, 201, r1.data)
        b1 = self.api.get(f"/api/bills/{r1.data['id']}").data
        self.assertEqual(b1["lines"][0]["units"], 30)  # Oct 1 -> Oct 31

        self.challan("2026-11-10T10:00", self.back(self.item1, 10))
        r2 = self.api.post("/api/bills", {"customer_id": self.cust.id, "upto": "2026-11-10T12:00"}, format="json")
        b2 = self.api.get(f"/api/bills/{r2.data['id']}").data
        self.assertEqual(b2["lines"][0]["units"], 10)  # Oct 31 -> Nov 10; total 40 days
        self.assertEqual(b2["lines"][0]["prev_units"], 30)
        self.assertEqual(b2["total"], 500.0)

        # Entries before the last bill are locked
        self.challan("2026-11-09T10:00", self.give(self.item1, 1), expect=400)

    def test_hourly_item(self):
        self.challan("2026-11-01T08:00", self.give(self.mixer, 1))
        self.challan("2026-11-01T13:30", self.back(self.mixer, 1))
        pv = self.api.get(f"/api/customers/{self.cust.id}/preview", {"at": "2026-11-01T14:00"}).data
        self.assertEqual(pv["lines"][0]["units"], 6)  # 5h30m -> 6 hours
        self.assertEqual(pv["rent_total"], 900.0)

    def test_custom_rate_is_kept_when_item_rate_changes(self):
        self.challan("2026-11-01T10:00", self.give(self.item1, 2, rate=4))
        self.api.put(f"/api/items/{self.item1.id}", {"rate": 9}, format="json")
        pv = self.api.get(f"/api/customers/{self.cust.id}/preview", {"at": "2026-11-04T10:00"}).data
        self.assertEqual(pv["rent_total"], 24.0)  # 2 x 3 days x 4

    def test_stock_and_return_validation(self):
        res = self.challan("2026-11-01T10:00", self.give(self.mixer, 3), expect=400)
        self.assertIn("Only 2", str(res))
        self.challan("2026-11-01T10:00", self.give(self.item2, 4))
        res = self.challan("2026-11-02T10:00", self.back(self.item2, 5), expect=400)
        self.assertIn("only 4", str(res))
        # returning before it was given is rejected too
        self.challan("2026-10-30T10:00", self.back(self.item2, 1), expect=400)

    def test_cannot_delete_issue_that_was_returned(self):
        issue = self.challan("2026-11-01T10:00", self.give(self.item2, 4))
        self.challan("2026-11-02T10:00", self.back(self.item2, 4))
        res = self.api.delete(f"/api/challans/{issue['id']}")
        self.assertEqual(res.status_code, 400)

    def test_item_stock_cannot_go_below_out(self):
        self.challan("2026-11-01T10:00", self.give(self.item2, 40))
        res = self.api.put(f"/api/items/{self.item2.id}", {"total_qty": 30}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_dashboard_counts_each_customer_once(self):
        self.challan("2026-11-01T10:00", self.give(self.item1, 3))
        self.challan("2026-11-02T10:00", self.give(self.item2, 1))
        self.challan("2026-11-03T10:00", self.back(self.item2, 1))
        d = self.api.get("/api/dashboard", {"at": "2026-11-04T10:00"}).data
        self.assertEqual(d["active_customers"], 1)
        self.assertEqual(d["pcs_out"], 3)
        self.assertEqual(d["running_rent"], 3 * 3 * 5 + 1 * 1 * 3)

    def test_requires_login(self):
        self.assertEqual(APIClient().get("/api/items").status_code, 403)


class ShutteringAppFeatureTests(FlowBase):
    """Sites, lost items, GST bills, TDS and reports."""

    def setUp(self):
        super().setUp()
        self.item1.lost_rate = Decimal("500")
        self.item1.save()

    def site(self, name, customer=None):
        res = self.api.post(f"/api/customers/{(customer or self.cust).id}/sites", {"name": name}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        return res.data["id"]

    def challan_at(self, site_id, when, *lines, expect=201, **extra):
        body = {"customer_id": self.cust.id, "site_id": site_id, "at": when, "lines": list(lines), **extra}
        res = self.api.post("/api/challans", body, format="json")
        self.assertEqual(res.status_code, expect, res.data)
        return res.data

    @staticmethod
    def lost(item, qty, **kw):
        return {"item_id": item.id, "direction": "in", "qty": qty, "lost": True, **kw}

    def bill(self, upto, expect=201, **kw):
        res = self.api.post("/api/bills", {"customer_id": self.cust.id, "upto": upto, **kw}, format="json")
        self.assertEqual(res.status_code, expect, res.data)
        return self.api.get(f"/api/bills/{res.data['id']}").data if expect == 201 else res.data

    def test_items_are_tracked_per_site(self):
        a, b = self.site("Model Town"), self.site("GT Road")
        self.challan_at(a, "2026-11-01T10:00", self.give(self.item1, 10), vehicle="pb10 ab 1234")
        self.challan_at(b, "2026-11-01T11:00", self.give(self.item1, 5))
        # site B only has 5
        res = self.challan_at(b, "2026-11-02T10:00", self.back(self.item1, 8), expect=400)
        self.assertIn("GT Road", str(res))
        self.challan_at(a, "2026-11-03T10:00", self.back(self.item1, 10))

        acc = self.api.get(f"/api/customers/{self.cust.id}").data
        self.assertEqual([(h["site_name"], h["qty"]) for h in acc["holdings"]], [("GT Road", 5)])
        self.assertEqual({s["name"]: s["pcs_out"] for s in acc["sites"]}, {"GT Road": 5, "Model Town": 0})
        ch = self.api.get("/api/challans", {"site": a}).data
        self.assertEqual(len(ch), 2)
        self.assertEqual(ch[-1]["vehicle"], "PB10 AB 1234")

        pv = self.api.get(f"/api/customers/{self.cust.id}/preview", {"at": "2026-11-03T18:00"}).data
        got = sorted((l["site_name"], l["qty"], l["units"]) for l in pv["lines"])
        self.assertEqual(got, [("GT Road", 5, 2), ("Model Town", 10, 2)])

    def test_return_from_many_sites_in_one_go(self):
        a, b = self.site("Main Road"), self.site("Model Town")
        self.challan_at(a, "2026-11-01T10:00", self.give(self.item1, 5))
        self.challan_at(b, "2026-11-01T11:00", self.give(self.item1, 1), self.give(self.item2, 2))

        def ret(groups, expect):
            body = {"customer_id": self.cust.id, "at": "2026-11-04T10:00", "vehicle": "pb10", "groups": groups}
            res = self.api.post("/api/challans", body, format="json")
            self.assertEqual(res.status_code, expect, res.data)
            return res.data

        # Model Town has only 1 plate: nothing is saved, not even the Main Road part
        ret([{"site_id": a, "lines": [self.back(self.item1, 5)]}, {"site_id": b, "lines": [self.back(self.item1, 3)]}], 400)
        self.assertEqual(self.items()["Plate 3x2"]["available"], 94)

        res = ret(
            [
                {"site_id": a, "lines": [self.back(self.item1, 5)]},
                {"site_id": b, "lines": [self.back(self.item1, 1), self.lost(self.item2, 1)]},
            ],
            201,
        )
        self.assertEqual(len(res["ids"]), 2)
        made = [self.api.get(f"/api/challans/{i}").data for i in res["ids"]]
        self.assertEqual([(c["site_name"], c["kind"], c["vehicle"]) for c in made], [("Main Road", "return", "PB10"), ("Model Town", "return", "PB10")])
        acc = self.api.get(f"/api/customers/{self.cust.id}").data
        self.assertEqual([(h["site_name"], h["item_name"], h["qty"]) for h in acc["holdings"]], [("Model Town", "Prop 10ft", 1)])
        self.assertEqual(self.items()["Plate 3x2"]["available"], 100)

    def test_replace_at_many_sites_in_one_go(self):
        a, b = self.site("Main Road"), self.site("Model Town")
        self.challan_at(a, "2026-11-01T10:00", self.give(self.item1, 5))
        self.challan_at(b, "2026-11-01T11:00", self.give(self.item3, 50))  # no Prop 12ft left in store

        def swap(give_at_a, expect):
            groups = [
                {"site_id": a, "lines": [self.back(self.item1, 5), self.give(self.item3, give_at_a, replaces_item_id=self.item1.id)]},
                {"site_id": b, "lines": [self.back(self.item3, 5), self.give(self.item1, 5, replaces_item_id=self.item3.id)]},
            ]
            body = {"customer_id": self.cust.id, "at": "2026-11-04T10:00", "groups": groups}
            res = self.api.post("/api/challans", body, format="json")
            self.assertEqual(res.status_code, expect, res.data)
            return res.data

        # Main Road can't get 6 props: only the 5 coming back from Model Town are free
        self.assertIn("Prop 12ft", str(swap(6, 400)))
        # Main Road gets the 5 props that Model Town gives back, in the same save
        res = swap(5, 201)
        self.assertEqual([self.api.get(f"/api/challans/{i}").data["kind"] for i in res["ids"]], ["swap", "swap"])
        acc = self.api.get(f"/api/customers/{self.cust.id}").data
        got = sorted((h["site_name"], h["item_name"], h["qty"]) for h in acc["holdings"])
        self.assertEqual(got, [("Main Road", "Prop 12ft", 5), ("Model Town", "Plate 3x2", 5), ("Model Town", "Prop 12ft", 45)])

    def test_site_of_another_customer_is_rejected(self):
        other = Customer.objects.create(name="Customer B")
        their_site = self.site("Their site", other)
        self.challan_at(their_site, "2026-11-01T10:00", self.give(self.item1, 1), expect=400)
        res = self.api.delete(f"/api/sites/{their_site}")
        self.assertEqual(res.status_code, 204)

    def test_issue_to_a_new_customer_creates_them_with_the_challan(self):
        body = {
            "new_customer": {"name": "  Ravi  ", "phone": "98765 43210"},
            "new_site": "Model Town",
            "at": "2026-11-01T10:00",
            "lines": [self.give(self.item1, 4)],
        }
        res = self.api.post("/api/challans", body, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        ravi = Customer.objects.get(pk=res.data["customer_id"])
        self.assertEqual((ravi.name, ravi.phone), ("Ravi", "98765 43210"))
        self.assertEqual([s.name for s in ravi.sites.all()], ["Model Town"])
        ch = self.api.get(f"/api/challans/{res.data['id']}").data
        self.assertEqual(ch["site_name"], "Model Town")

        # too many pieces: nothing is saved, not even the customer
        body = {**body, "new_customer": {"name": "Sita"}, "lines": [self.give(self.item1, 500)]}
        self.assertEqual(self.api.post("/api/challans", body, format="json").status_code, 400)
        self.assertFalse(Customer.objects.filter(name="Sita").exists())
        # a name is needed
        body = {**body, "new_customer": {"name": " ", "phone": "1"}, "lines": [self.give(self.item1, 1)]}
        self.assertEqual(self.api.post("/api/challans", body, format="json").status_code, 400)

    def test_new_site_name_reuses_the_customers_site(self):
        a = self.site("GT Road")
        self.challan_at(None, "2026-11-01T10:00", self.give(self.item1, 2), new_site="gt road")
        acc = self.api.get(f"/api/customers/{self.cust.id}").data
        self.assertEqual({s["id"]: s["pcs_out"] for s in acc["sites"]}, {a: 2})

    def test_lost_items_stop_rent_reduce_stock_and_are_billed_once(self):
        self.challan("2026-11-01T10:00", self.give(self.item1, 10))
        self.challan("2026-11-03T10:00", self.back(self.item1, 7), self.lost(self.item1, 3))
        stock = self.items()["Plate 3x2"]
        self.assertEqual((stock["total_qty"], stock["available"], stock["out_qty"], stock["lost_qty"]), (97, 97, 0, 3))

        bill = self.bill("2026-11-04T10:00")
        self.assertEqual(bill["rent_total"], 100.0)  # 10 x 2 days x 5: lost ones stop at the report time too
        self.assertEqual(bill["lost_total"], 1500.0)  # 3 x 500
        self.assertEqual(bill["total"], 1600.0)
        rent_status = sorted((l["qty"], l["status"]) for l in bill["lines"] if l["kind"] == "rent")
        self.assertEqual(rent_status, [(3, "lost"), (7, "returned")])
        lost_lines = [l for l in bill["lines"] if l["kind"] == "lost"]
        self.assertEqual([(l["item_name"], l["qty"], l["rate"]) for l in lost_lines], [("Plate 3x2", 3, 500.0)])

        # next bill doesn't charge them again
        self.challan("2026-11-05T10:00", self.give(self.item1, 1))
        b2 = self.bill("2026-11-06T10:00")
        self.assertEqual(b2["lost_total"], 0.0)

    def test_lost_price_can_be_changed_and_deleting_puts_stock_back(self):
        self.challan("2026-11-01T10:00", self.give(self.item1, 4))
        ch = self.challan("2026-11-02T10:00", self.lost(self.item1, 4, rate=450))
        self.assertEqual(self.items()["Plate 3x2"]["total_qty"], 96)
        pv = self.api.get(f"/api/customers/{self.cust.id}/preview", {"at": "2026-11-02T12:00"}).data
        self.assertEqual(pv["lost_total"], 1800.0)
        # can't report more lost than the customer has
        self.challan("2026-11-03T10:00", self.lost(self.item1, 1), expect=400)

        self.assertEqual(self.api.delete(f"/api/challans/{ch['id']}").status_code, 204)
        stock = self.items()["Plate 3x2"]
        self.assertEqual((stock["total_qty"], stock["out_qty"], stock["lost_qty"]), (100, 4, 0))

    def test_gst_bill_same_state_and_other_state(self):
        self.api.put("/api/settings", {"gst_enabled": True, "gstin": "03abcde1234f1z5", "gst_rate": 18}, format="json")
        self.assertEqual(self.api.get("/api/settings").data["gstin"], "03ABCDE1234F1Z5")
        self.api.put(f"/api/customers/{self.cust.id}", {"gstin": "03PQRST5678K1Z2"}, format="json")

        self.challan("2026-11-01T10:00", self.give(self.item1, 10))
        bill = self.bill("2026-11-03T10:00", extras=[{"description": "Transport", "amount": 100}])
        self.assertEqual(bill["gst_type"], "intra")
        self.assertEqual(bill["taxable"], 200.0)  # 100 rent + 100 transport
        self.assertEqual((bill["cgst"], bill["sgst"], bill["igst"]), (18.0, 18.0, 0.0))
        self.assertEqual(bill["total"], 236.0)
        self.assertEqual(bill["customer_gstin"], "03PQRST5678K1Z2")

        # customer from another state -> IGST
        self.api.put(f"/api/customers/{self.cust.id}", {"gstin": "07PQRST5678K1Z2"}, format="json")
        b2 = self.bill("2026-11-04T10:00")
        self.assertEqual((b2["gst_type"], b2["igst"], b2["total"]), ("inter", 9.0, 59.0))

        # can also be turned off for one bill
        b3 = self.bill("2026-11-05T10:00", gst_type="none")
        self.assertEqual((b3["gst_type"], b3["total"]), ("none", 50.0))

        res = self.api.put(f"/api/customers/{self.cust.id}", {"gstin": "12345"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_no_gst_by_default(self):
        self.challan("2026-11-01T10:00", self.give(self.item1, 10))
        bill = self.bill("2026-11-03T10:00")
        self.assertEqual((bill["gst_type"], bill["taxable"], bill["total"]), ("none", 100.0, 100.0))

    def test_tds_counts_towards_balance(self):
        self.challan("2026-11-01T10:00", self.give(self.item1, 100))
        self.bill("2026-11-03T10:00")  # 100 x 2 x 5 = 1000
        pay = lambda **kw: self.api.post(  # noqa: E731
            "/api/payments", {"customer": self.cust.id, "date": "2026-11-04", "mode": "UPI", **kw}, format="json"
        )
        self.assertEqual(pay(amount=900, tds=100).status_code, 201)
        self.assertEqual(self.api.get(f"/api/customers/{self.cust.id}").data["balance"], 0)
        self.assertEqual(pay(tds=10).status_code, 201)  # TDS entered later, on its own
        self.assertEqual(pay(amount=0).status_code, 400)

    def test_reports(self):
        a = self.site("Model Town")
        self.challan_at(a, "2026-11-01T10:00", self.give(self.item1, 10), self.give(self.item2, 4))
        self.challan_at(a, "2026-11-03T10:00", self.back(self.item2, 4), self.lost(self.item1, 2))
        b1 = self.bill("2026-11-03T12:00")
        self.api.post("/api/payments", {"customer": self.cust.id, "date": "2026-11-03", "amount": 50, "tds": 5}, format="json")

        daily = self.api.get("/api/reports/daily", {"date": "2026-11-03"}).data
        self.assertEqual(len(daily["challans"]), 1)
        self.assertEqual(
            {m["item_name"]: (m["given"], m["back"], m["lost"]) for m in daily["moves"]},
            {"Plate 3x2": (0, 0, 2), "Prop 10ft": (0, 4, 0)},
        )
        self.assertEqual((daily["billed"], daily["received"], daily["tds"]), (b1["total"], 50.0, 5.0))

        due = self.api.get("/api/reports/outstanding").data
        self.assertEqual(due["rows"][0]["balance"], b1["total"] - 55)
        self.assertEqual(due["rows"][0]["pcs_out"], 8)

        month = self.api.get("/api/reports/monthly", {"year": 2026}).data["months"][10]
        self.assertEqual((month["bills"], month["lost"], month["received"]), (1, 1000.0, 50.0))

        stock = {r["item_name"]: r for r in self.api.get("/api/reports/stock").data["rows"]}
        self.assertEqual(stock["Plate 3x2"]["holders"], [{"customer_id": self.cust.id, "customer_name": "Customer A", "site_name": "Model Town", "qty": 8}])
        self.assertEqual((stock["Plate 3x2"]["total_qty"], stock["Plate 3x2"]["lost_qty"]), (98, 2))

        gst = self.api.get("/api/reports/gst", {"month": "2026-11"}).data
        self.assertEqual([r["bill_no"] for r in gst["rows"]], [b1["bill_no"]])
        self.assertEqual(gst["missing_bill_nos"], [])
        csv = self.api.get("/api/reports/gst", {"month": "2026-11", "download": "csv"})
        self.assertEqual(csv.status_code, 200)
        self.assertIn("Bill no,Date,Customer", csv.content.decode())

        filtered = self.api.get("/api/challans", {"from": "2026-11-02", "to": "2026-11-03"}).data
        self.assertEqual([c["kind"] for c in filtered], ["return"])

    def test_missing_bill_numbers(self):
        other = Customer.objects.create(name="Customer B")
        self.challan("2026-11-01T10:00", self.give(self.item1, 1))
        first = self.bill("2026-11-02T10:00")
        res = self.api.post("/api/challans", {"customer_id": other.id, "at": "2026-11-01T10:00", "lines": [self.give(self.item1, 1)]}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(self.api.post("/api/bills", {"customer_id": other.id, "upto": "2026-11-02T10:00"}, format="json").status_code, 201)
        self.api.delete(f"/api/bills/{first['id']}")  # bill #1 deleted -> gap
        gst = self.api.get("/api/reports/gst", {"month": "2026-11"}).data
        self.assertEqual(gst["missing_bill_nos"], [1])


class ForgotPasswordTests(TestCase):
    def setUp(self):
        cache.clear()  # the reset limit is counted in the cache
        self.user = get_user_model().objects.create_user("gagan", password="oldpass123")

    def make_key(self):
        api = APIClient()
        api.force_authenticate(self.user)
        self.assertFalse(api.get("/api/auth/recovery-key").data["has_key"])
        key = api.post("/api/auth/recovery-key").data["key"]
        self.assertRegex(key, r"^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$")
        self.assertTrue(api.get("/api/auth/recovery-key").data["has_key"])
        return key

    def reset(self, key, password="newpass123", username="gagan", client=None):
        return (client or APIClient()).post(
            "/api/auth/reset-password", {"username": username, "key": key, "new_password": password}, format="json"
        )

    def test_reset_with_key_sets_password_logs_in_and_gives_a_new_key(self):
        key = self.make_key()
        client = APIClient()
        res = self.reset(" " + key.lower().replace("-", " ") + " ", client=client)  # typed loosely
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(client.get("/api/auth/me").data["user"]["username"], "gagan")
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("newpass123"))

        new_key = res.data["recovery_key"]
        self.assertNotEqual(new_key, key)
        self.assertEqual(self.reset(key, "another123").status_code, 400)  # old key is used up
        self.assertEqual(self.reset(new_key, "another123").status_code, 200)

    def test_wrong_key_wrong_user_or_no_key(self):
        self.assertEqual(self.reset("AAAA-BBBB-CCCC-DDDD").status_code, 400)  # no key made yet
        key = self.make_key()
        self.assertEqual(self.reset("AAAA-BBBB-CCCC-DDDD").status_code, 400)
        res = self.reset(key, username="nobody")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Username or recovery key is wrong", str(res.data))
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("oldpass123"))

    def test_short_password_is_refused_and_key_still_works(self):
        key = self.make_key()
        res = self.reset(key, password="abc")
        self.assertEqual(res.status_code, 400)
        self.assertIn("too short", str(res.data))
        self.assertEqual(self.reset(key).status_code, 200)

    def test_guessing_is_limited(self):
        self.make_key()
        codes = [self.reset("AAAA-BBBB-CCCC-DDDD").status_code for _ in range(11)]
        self.assertEqual(codes[:10], [400] * 10)
        self.assertEqual(codes[10], 429)


class LoginManagementTests(TestCase):
    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.owner = User.objects.create_superuser("gagan", password="ownerpass1")
        self.api = APIClient()
        self.api.force_authenticate(self.owner)

    def test_owner_adds_staff_and_sets_passwords(self):
        res = self.api.post("/api/logins", {"username": "harpreet", "password": "staffpass1", "role": "staff"}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        staff_id = res.data["id"]
        self.assertTrue(APIClient().login(username="harpreet", password="staffpass1"))
        self.assertEqual(
            [(r["username"], r["role"]) for r in self.api.get("/api/logins").data], [("gagan", "owner"), ("harpreet", "staff")]
        )

        self.assertEqual(self.api.put(f"/api/logins/{staff_id}", {"password": "changed123"}, format="json").status_code, 200)
        self.assertTrue(APIClient().login(username="harpreet", password="changed123"))
        self.assertEqual(self.api.put(f"/api/logins/{staff_id}", {"is_active": False}, format="json").status_code, 200)
        self.assertFalse(APIClient().login(username="harpreet", password="changed123"))

        # staff can't manage logins
        staff = APIClient()
        staff.force_authenticate(get_user_model().objects.get(pk=staff_id))
        self.assertEqual(staff.get("/api/logins").status_code, 403)

    def test_bad_input_and_no_self_lockout(self):
        post = lambda **kw: self.api.post("/api/logins", {"password": "longenough1", **kw}, format="json")  # noqa: E731
        self.assertEqual(post(username="GAGAN").status_code, 400)  # taken (any case)
        self.assertEqual(post(username="two words").status_code, 400)
        self.assertEqual(post(username="ok", password="abc").status_code, 400)
        me = f"/api/logins/{self.owner.id}"
        self.assertEqual(self.api.put(me, {"is_active": False}, format="json").status_code, 400)
        self.assertEqual(self.api.put(me, {"role": "staff"}, format="json").status_code, 400)

    def test_owner_changing_own_password_stays_logged_in(self):
        client = APIClient()
        client.login(username="gagan", password="ownerpass1")
        res = client.put(f"/api/logins/{self.owner.id}", {"password": "brandnew1"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(client.get("/api/auth/me").data["user"]["username"], "gagan")

    def test_create_login_from_login_page_only_on_shop_computer(self):
        anon = APIClient()
        self.assertTrue(anon.get("/api/auth/me").data["shop_computer"])
        res = anon.post("/api/auth/create-login", {"username": "newowner", "password": "newowner1"}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data["user"]["is_owner"])
        self.assertEqual(anon.get("/api/auth/me").data["user"]["username"], "newowner")  # logged in

        phone = APIClient(REMOTE_ADDR="192.168.1.20")
        self.assertFalse(phone.get("/api/auth/me").data["shop_computer"])
        res = phone.post("/api/auth/create-login", {"username": "intruder", "password": "intruder1"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertFalse(get_user_model().objects.filter(username="intruder").exists())
