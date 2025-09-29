/**
 * Field Map Page
 * Interactive map showing fields and basic geolocation.
 */
(function () {
  class FieldMapPage {
    constructor() {
      this.map = null;
      this.layers = { fields: null, user: null };
      this.apiService = null;
      this.authService = null;
      this.eventBus = null;
    }

    async init(app) {
      this.apiService = app.getModule("apiService");
      this.authService = app.getModule("authService");
      this.eventBus = app.getEventBus();

      // Require authentication
      if (!this.authService || !this.authService.requireAuth("/login.html"))
        return;

      this._initMap();
      this._setupUI();
      await this._loadFieldsIfAvailable();
    }

    _initMap() {
      const mapEl = document.getElementById("map");
      if (!mapEl) {
        console.error("Map element not found");
        return;
      }

      // Default center (Europe)
      this.map = L.map("map");
      const tiles = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        },
      );
      tiles.addTo(this.map);

      // Fit to a sensible world view
      this.map.setView([52.0, 19.0], 6);

      // Click to add a temporary marker
      this.map.on("click", (e) => {
        const { lat, lng } = e.latlng;
        L.marker([lat, lng])
          .addTo(this.map)
          .bindPopup(`Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`)
          .openPopup();
      });
    }

    _setupUI() {
      const locateBtn = document.getElementById("locateMeBtn");
      const msg = document.getElementById("mapMessage");
      if (locateBtn) {
        locateBtn.addEventListener("click", () => {
          if (!this.map || !navigator.geolocation) {
            msg && (msg.textContent = "Geolocation not available.");
            return;
          }
          msg && (msg.textContent = "Locating...");
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const { latitude, longitude } = pos.coords;
              const marker = L.marker([latitude, longitude], {
                title: "You are here",
              });
              marker.addTo(this.map).bindPopup("You are here").openPopup();
              this.map.setView([latitude, longitude], 14);
              msg && (msg.textContent = "");
            },
            (err) => {
              msg && (msg.textContent = "Failed to get location.");
            },
          );
        });
      }
    }

    async _loadFieldsIfAvailable() {
      // Optional: if backend exposes fields with coordinates, render them.
      // We'll call GET /api/v1/fieldsmap (if exists) or just skip silently.
      try {
        const res = await this.apiService.get("map/fieldsmap", {
          requiresAuth: true,
        });
        if (res && res.success && Array.isArray(res.data)) {
          const withGeo = res.data.filter(
            (f) => Array.isArray(f.coords) && f.coords.length >= 2,
          );
          if (withGeo.length) {
            const group = L.layerGroup();
            withGeo.forEach((f) => {
              const [lat, lng] = f.coords;
              const mk = L.marker([lat, lng]);
              mk.bindPopup(
                `<strong>${f.name}</strong>${f.area ? ` - ${f.area} ha` : ""}`,
              );
              mk.addTo(group);
            });
            group.addTo(this.map);
            this.layers.fields = group;
            try {
              const bounds = group.getBounds();
              if (bounds.isValid()) this.map.fitBounds(bounds.pad(0.2));
            } catch (_) {}
          }
        }
      } catch (_) {
        // Silently ignore if endpoint is missing; the map still works
      }
    }
  }

  window.FieldMapPage = FieldMapPage;
})();
