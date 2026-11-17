from django.urls import path

from . import reports, views

urlpatterns = [
    path("auth/me", views.me_view),
    path("auth/login", views.login_view),
    path("auth/logout", views.logout_view),
    path("auth/recovery-key", views.recovery_key_view),
    path("auth/reset-password", views.reset_password_view),
    path("settings", views.settings_view),
    path("dashboard", views.dashboard_view),
    path("export", views.export_view),
    path("items", views.items_view),
    path("items/<int:pk>", views.item_detail_view),
    path("customers", views.customers_view),
    path("customers/<int:pk>", views.customer_detail_view),
    path("customers/<int:pk>/preview", views.customer_preview_view),
    path("customers/<int:pk>/sites", views.customer_sites_view),
    path("sites/<int:pk>", views.site_detail_view),
    path("challans", views.challans_view),
    path("challans/<int:pk>", views.challan_detail_view),
    path("bills", views.bills_view),
    path("bills/<int:pk>", views.bill_detail_view),
    path("payments", views.payments_view),
    path("payments/<int:pk>", views.payment_detail_view),
    path("reports/outstanding", reports.outstanding_view),
    path("reports/daily", reports.daily_view),
    path("reports/monthly", reports.monthly_view),
    path("reports/stock", reports.stock_view),
    path("reports/gst", reports.gst_view),
]
