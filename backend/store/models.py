from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Lower

BASIS_CHOICES = [("day", "Per day"), ("hour", "Per hour")]

DAY_MODE_CHOICES = [
    ("calendar", "By date: issue day counted, return day not counted"),
    ("inclusive", "By date: both issue day and return day counted"),
    ("24h", "Every 24 hours from issue time (with grace hours)"),
]


class ShopSettings(models.Model):
    """Single row (pk=1) with shop details and billing rules."""

    shop_name = models.CharField(max_length=120, default="My Shuttering Store")
    address = models.CharField(max_length=300, blank=True, default="")
    phone = models.CharField(max_length=60, blank=True, default="")
    day_mode = models.CharField(max_length=10, choices=DAY_MODE_CHOICES, default="calendar")
    grace_hours = models.PositiveSmallIntegerField(default=2, validators=[MaxValueValidator(23)])
    bill_terms = models.CharField(
        max_length=500,
        blank=True,
        default="Rent is charged until the material is returned to the store.",
    )
    # GST (off by default: plain rent bills)
    gst_enabled = models.BooleanField("make GST bills", default=False)
    gstin = models.CharField("shop GSTIN", max_length=15, blank=True, default="")
    gst_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("18"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("28"))],
    )
    sac_code = models.CharField("SAC / HSN code", max_length=10, blank=True, default="997314")

    class Meta:
        verbose_name = verbose_name_plural = "shop settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        return cls.objects.get_or_create(pk=1)[0]

    def __str__(self):
        return self.shop_name


class Item(models.Model):
    """A kind of material in the store (plate, prop, jack, ...)."""

    name = models.CharField(max_length=120)
    unit = models.CharField(max_length=20, default="pcs")
    total_qty = models.PositiveIntegerField("total stock", default=0)
    rate = models.DecimalField("rent", max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal("0"))])
    basis = models.CharField("rent per", max_length=4, choices=BASIS_CHOICES, default="day")
    category = models.CharField(max_length=60, blank=True, default="")
    lost_rate = models.DecimalField(
        "price if lost", max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0"))]
    )
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = [Lower("name")]
        constraints = [models.UniqueConstraint(Lower("name"), name="item_name_unique_ci")]

    def __str__(self):
        return self.name


class Customer(models.Model):
    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=30, blank=True, default="")
    address = models.CharField("address / site", max_length=300, blank=True, default="")
    gstin = models.CharField("GSTIN", max_length=15, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = [Lower("name")]

    def __str__(self):
        return self.name


class Site(models.Model):
    """A work site of a customer. Items are tracked per site."""

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="sites")
    name = models.CharField(max_length=120)
    address = models.CharField(max_length=300, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = [Lower("name")]
        constraints = [models.UniqueConstraint("customer", Lower("name"), name="site_name_unique_per_customer")]

    def __str__(self):
        return self.name


class Challan(models.Model):
    """One visit: items given to and/or taken back from a customer at a time."""

    KIND_CHOICES = [("issue", "Issue"), ("return", "Return"), ("swap", "Return + Replace")]

    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="challans")
    site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.PROTECT, related_name="challans")
    kind = models.CharField(max_length=6, choices=KIND_CHOICES)
    at = models.DateTimeField(db_index=True)
    vehicle = models.CharField("vehicle no.", max_length=30, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-at", "-id"]
        indexes = [models.Index(fields=["customer", "at"])]

    def __str__(self):
        return f"Challan #{self.pk} ({self.get_kind_display()})"


class ChallanLine(models.Model):
    """direction='out': given to customer (rent starts). 'in': returned (rent stops).
    'in' with lost=True: the customer lost these pieces. Rent stops, the pieces leave
    the store's stock for good, and `rate` is the price per piece charged on the next bill."""

    DIRECTION_CHOICES = [("out", "Given"), ("in", "Returned")]

    challan = models.ForeignKey(Challan, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="challan_lines")
    direction = models.CharField(max_length=3, choices=DIRECTION_CHOICES)
    qty = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    lost = models.BooleanField(default=False)
    # Rent agreed when given ('out' lines), or price per lost piece ('in' + lost). Changing the item's rent later
    # does not change material that is already out.
    rate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    basis = models.CharField(max_length=4, choices=BASIS_CHOICES, null=True, blank=True)
    # For 'out' lines given in place of another item (replacement).
    replaces = models.ForeignKey(Item, null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["id"]
        constraints = [models.CheckConstraint(condition=models.Q(qty__gt=0), name="challanline_qty_positive")]


GST_TYPE_CHOICES = [
    ("none", "No GST"),
    ("intra", "CGST + SGST (same state)"),
    ("inter", "IGST (other state)"),
]


class Bill(models.Model):
    bill_no = models.PositiveIntegerField(unique=True)
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="bills")
    from_at = models.DateTimeField(null=True, blank=True)  # previous bill's upto_at
    upto_at = models.DateTimeField()
    day_mode = models.CharField(max_length=10, choices=DAY_MODE_CHOICES)
    grace_hours = models.PositiveSmallIntegerField(default=0)
    rent_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    lost_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    extras_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # GST: taxable = rent + lost + extras - discount; total = taxable + cgst + sgst + igst
    gst_type = models.CharField(max_length=5, choices=GST_TYPE_CHOICES, default="none")
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    taxable = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    igst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    customer_gstin = models.CharField(max_length=15, blank=True, default="")
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-bill_no"]

    def __str__(self):
        return f"Bill #{self.bill_no}"


class BillLine(models.Model):
    KIND_CHOICES = [("rent", "Rent"), ("lost", "Lost items"), ("extra", "Other charge")]

    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name="lines")
    kind = models.CharField(max_length=5, choices=KIND_CHOICES)
    description = models.CharField(max_length=200, blank=True, default="")
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL)
    item_name = models.CharField(max_length=120, blank=True, default="")
    site_name = models.CharField(max_length=120, blank=True, default="")
    unit = models.CharField(max_length=20, blank=True, default="")
    qty = models.PositiveIntegerField(null=True, blank=True)
    from_at = models.DateTimeField(null=True, blank=True)
    to_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, blank=True, default="")  # returned / out
    units = models.PositiveIntegerField(null=True, blank=True)  # days or hours charged in this bill
    prev_units = models.PositiveIntegerField(null=True, blank=True)  # already charged in earlier bills
    basis = models.CharField(max_length=4, blank=True, default="")
    rate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["id"]


class Payment(models.Model):
    MODE_CHOICES = [("Cash", "Cash"), ("UPI", "UPI"), ("Bank", "Bank transfer"), ("Cheque", "Cheque"), ("Other", "Other")]

    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="payments")
    date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0"))])
    # Income tax the customer deducted (TDS) and paid to the government for you.
    # It clears the balance just like money received.
    tds = models.DecimalField("TDS deducted", max_digits=12, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0"))])
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default="Cash")
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-date", "-id"]


class RecoveryKey(models.Model):
    """A user's password recovery key, stored hashed like a password.
    The key itself is shown only once, when it is made."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recovery_key")
    key_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
