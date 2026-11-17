"""
Start the shop app (Django API + built React app) with the waitress server.

    .venv/bin/python serve.py            # port 8000, reachable from phones on the same Wi-Fi
    .venv/bin/python serve.py --local    # only this computer
"""
import argparse
import os
import socket


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is sent
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    parser = argparse.ArgumentParser(description="Run the Shuttering Store app")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    parser.add_argument("--local", action="store_true", help="only allow this computer (127.0.0.1)")
    args = parser.parse_args()

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    from django.core.wsgi import get_wsgi_application
    from waitress import serve

    app = get_wsgi_application()
    host = "127.0.0.1" if args.local else "0.0.0.0"
    print(f"\n  Shuttering Store is running:  http://localhost:{args.port}")
    ip = lan_ip()
    if not args.local and ip:
        print(f"  On phones (same Wi-Fi):       http://{ip}:{args.port}")
    print("  Press Ctrl+C to stop.\n")
    serve(app, host=host, port=args.port, threads=8)


if __name__ == "__main__":
    main()
