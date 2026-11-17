from django.conf import settings
from django.contrib import admin
from django.http import HttpResponse
from django.urls import include, path, re_path
from django.views.static import serve


def frontend_index(request):
    """Serve the built React app for every non-API URL (client-side routing)."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        return HttpResponse(
            "<h2>Frontend is not built yet</h2><p>Run <code>./setup.sh</code> "
            "(or <code>cd frontend &amp;&amp; npm install &amp;&amp; npm run build</code>) and restart.</p>",
            status=503,
        )
    return HttpResponse(index.read_bytes(), content_type="text/html; charset=utf-8")


admin.site.site_header = "Shuttering Store admin"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("store.urls")),
    # WhiteNoise serves the built files it found at start-up. After `npm run build` while the
    # app is running, the new files are served from here, so the page doesn't go blank.
    # Missing files get a 404 instead of the HTML page.
    re_path(r"^(?P<path>assets/.+)$", serve, {"document_root": settings.FRONTEND_DIST}),
    re_path(r"^(?!api/|admin/|static/|assets/).*$", frontend_index),
]
