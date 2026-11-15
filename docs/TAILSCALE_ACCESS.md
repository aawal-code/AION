# Tailscale remote-access investigation

Status: unavailable. AION does not configure Tailscale Serve, expose a remote URL, or enable Funnel. Tailscale was not connected during the Beta 1 investigation, so no remote connection has been tested. The backend accepts loopback bindings only; the native bootstrap endpoint rejects forwarded requests and non-loopback Host headers.

Tailscale Serve can provide tailnet-restricted HTTPS while proxying a loopback service ([Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve)). Tailnet membership or proxy headers must never substitute for AION device identity and capability checks. A DNS name alone does not establish that Serve, HTTPS certificates, or AION access are configured.

Before enabling a remote listener, AION needs an Owner-approved browser-device enrollment flow, a separately scoped remote authentication endpoint, secure cookies for the external HTTPS origin, exact origin/CSRF validation, revocation tests, and a way to prevent the local native bootstrap endpoint from being proxied. Tests must cover forged forwarded headers, Funnel/public exposure, revoked devices, and real tailnet access from another device. Existing local HTTP same-origin handling does not satisfy these requirements, so the old remote setup page, insecure profile generator, and automatic redirects remain disabled.
