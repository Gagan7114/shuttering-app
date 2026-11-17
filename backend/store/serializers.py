import re
from decimal import Decimal

from rest_framework import serializers

from .models import Customer, Item, Payment, ShopSettings, Site

GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def clean_gstin(value):
    value = (value or "").strip().upper().replace(" ", "")
    if value and not GSTIN_RE.match(value):
        raise serializers.ValidationError("GSTIN should be 15 characters, like 03ABCDE1234F1Z5.")
    return value


class ItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = ["id", "name", "unit", "total_qty", "rate", "basis", "category", "lost_rate", "note"]
        extra_kwargs = {
            "unit": {"required": False, "allow_blank": True},
            "note": {"required": False},
            "category": {"required": False},
            "lost_rate": {"required": False},
        }

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Item name is required.")
        same = Item.objects.filter(name__iexact=value)
        if self.instance:
            same = same.exclude(pk=self.instance.pk)
        if same.exists():
            raise serializers.ValidationError("An item with this name already exists.")
        return value

    def validate_unit(self, value):
        return (value or "").strip() or "pcs"

    def validate_category(self, value):
        value = (value or "").strip()
        # reuse the spelling already in use ("props" -> "Props")
        same = Item.objects.filter(category__iexact=value).values_list("category", flat=True).first()
        return same or value


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "name", "phone", "address", "gstin", "note"]
        extra_kwargs = {f: {"required": False} for f in ("phone", "address", "gstin", "note")}

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Customer name is required.")
        return value

    def validate_gstin(self, value):
        return clean_gstin(value)


class SiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = ["id", "customer", "name", "address", "note"]
        read_only_fields = ["customer"]
        extra_kwargs = {"address": {"required": False}, "note": {"required": False}}

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Site name is required.")
        customer = self.context.get("customer") or (self.instance and self.instance.customer)
        same = Site.objects.filter(customer=customer, name__iexact=value)
        if self.instance:
            same = same.exclude(pk=self.instance.pk)
        if same.exists():
            raise serializers.ValidationError("This customer already has a site with this name.")
        return value


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "customer", "date", "amount", "tds", "mode", "note"]
        extra_kwargs = {"note": {"required": False}, "tds": {"required": False}, "amount": {"required": False}}

    def validate(self, data):
        amount = data.get("amount") or Decimal(0)
        tds = data.get("tds") or Decimal(0)
        if amount + tds <= 0:
            raise serializers.ValidationError("Enter the amount received (or the TDS deducted).")
        data["amount"], data["tds"] = amount, tds
        return data


class ShopSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopSettings
        fields = [
            "shop_name",
            "address",
            "phone",
            "day_mode",
            "grace_hours",
            "bill_terms",
            "gst_enabled",
            "gstin",
            "gst_rate",
            "sac_code",
        ]

    def validate_gstin(self, value):
        return clean_gstin(value)

    def validate_sac_code(self, value):
        return (value or "").strip()
