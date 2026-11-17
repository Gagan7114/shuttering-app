from django.contrib import admin

from .models import Bill, BillLine, Challan, ChallanLine, Customer, Item, Payment, RecoveryKey, ShopSettings, Site


class ReadOnlyAdmin(admin.ModelAdmin):
    """Challans and bills change stock and money: edit them only through the app,
    which checks stock and bill locks. Admin can only view them."""

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ShopSettings)
class ShopSettingsAdmin(admin.ModelAdmin):
    list_display = ["shop_name", "phone", "day_mode", "grace_hours"]


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "unit", "total_qty", "rate", "basis", "lost_rate"]
    list_filter = ["category"]
    search_fields = ["name"]


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ["name", "phone", "address", "gstin"]
    search_fields = ["name", "phone", "gstin"]


@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    list_display = ["name", "customer", "address"]
    search_fields = ["name", "customer__name"]


class ChallanLineInline(admin.TabularInline):
    can_delete = False
    model = ChallanLine
    extra = 0


@admin.register(Challan)
class ChallanAdmin(ReadOnlyAdmin):
    list_display = ["id", "customer", "site", "kind", "at", "vehicle"]
    list_filter = ["kind"]
    search_fields = ["customer__name"]
    inlines = [ChallanLineInline]


class BillLineInline(admin.TabularInline):
    can_delete = False
    model = BillLine
    extra = 0


@admin.register(Bill)
class BillAdmin(ReadOnlyAdmin):
    list_display = ["bill_no", "customer", "upto_at", "gst_type", "taxable", "total"]
    search_fields = ["customer__name"]
    inlines = [BillLineInline]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["customer", "date", "amount", "tds", "mode"]
    search_fields = ["customer__name"]


@admin.register(RecoveryKey)
class RecoveryKeyAdmin(admin.ModelAdmin):
    """Only shows who has a key and when it was made; the key itself is never stored."""

    list_display = ["user", "created_at"]
    fields = ["user", "created_at"]
    readonly_fields = ["user", "created_at"]

    def has_add_permission(self, request, obj=None):
        return False
