(() => {
  "use strict";

  const FE_API = "https://www.fueleconomy.gov/ws/rest";
  const GEOCODE_API = "https://photon.komoot.io/api/";
  const ROUTE_API = "https://router.project-osrm.org/route/v1/driving/";
  const KWH_PER_GALLON_EQUIV = 33.7;
  const METERS_PER_MILE = 1609.344;
  const FIRST_YEAR = 1984;

  const $ = (id) => document.getElementById(id);
  const el = {
    form: $("trip-form"), from: $("from"), to: $("to"), roundTrip: $("round-trip"),
    year: $("year"), make: $("make"), model: $("model"), trim: $("trim"), trimField: $("trim-field"),
    vehicleInfo: $("vehicle-info"), manualMpg: $("manual-mpg"),
    fuelType: $("fuel-type"), price: $("price"), priceUnit: $("price-unit"), priceSource: $("price-source"),
    people: $("people"), peopleOut: $("people-out"), peopleWord: $("people-word"),
    calcBtn: $("calc-btn"), formError: $("form-error"),
    results: $("results"), routeLine: $("route-line"), totalCost: $("total-cost"), perPerson: $("per-person"),
    rDistance: $("r-distance"), rTime: $("r-time"), rFuel: $("r-fuel"), rMpg: $("r-mpg"),
    rPrice: $("r-price"), rCpm: $("r-cpm"), routeNote: $("route-note"), map: $("map"),
    shareBtn: $("share-btn"), priceTable: $("price-table"), priceTableNote: $("price-table-note"),
  };

  const state = {
    vehicleSource: "api",   // "api" or "fallback" (FuelEconomy.gov unreachable)
    vehicle: null,          // { label, mpg, kwhPer100, fuel }
    prices: null,           // { regular, midgrade, premium, diesel, e85, electric }
    pricesLive: false,
    places: { from: null, to: null }, // { label, lat, lon }
    map: null,
    mapLayer: null,
  };

  const FUEL_LABELS = {
    regular: "Regular", midgrade: "Midgrade", premium: "Premium",
    diesel: "Diesel", e85: "E85", electric: "Electricity",
  };

  // ---------- helpers ----------

  async function fetchJSON(url, { timeout = 12000, headers = {} } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // FuelEconomy.gov returns a single object instead of an array when there's one item.
  const menuItems = (data) => {
    const items = data && data.menuItem;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  };

  const money = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const num = (n, d = 1) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

  function setOptions(select, items, placeholder) {
    select.innerHTML = "";
    if (placeholder !== undefined) select.add(new Option(placeholder, ""));
    for (const { text, value } of items) select.add(new Option(text, value));
  }

  function formatDuration(seconds) {
    const mins = Math.round(seconds / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? `${h} h ${m} min` : `${m} min`;
  }

  function haversineMiles(a, b) {
    const R = 3958.8;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function showError(msg) {
    el.formError.textContent = msg;
    el.formError.hidden = !msg;
  }

  // ---------- fuel prices ----------

  async function loadPrices() {
    try {
      const data = await fetchJSON(`${FE_API}/fuelprices`);
      const prices = {};
      for (const key of Object.keys(FUEL_LABELS)) {
        const v = parseFloat(data[key]);
        if (v > 0) prices[key] = v;
      }
      if (!prices.regular) throw new Error("No price data");
      state.prices = { ...window.FALLBACK_PRICES, ...prices };
      state.pricesLive = true;
    } catch (err) {
      console.warn("Fuel price feed unavailable, using fallback prices:", err);
      state.prices = { ...window.FALLBACK_PRICES };
      state.pricesLive = false;
    }
    renderPriceTable();
    applyPriceForFuelType();
  }

  function renderPriceTable() {
    el.priceTable.innerHTML = "";
    for (const [key, label] of Object.entries(FUEL_LABELS)) {
      const p = state.prices[key];
      if (!p) continue;
      const row = el.priceTable.insertRow();
      row.insertCell().textContent = label;
      row.insertCell().textContent = key === "electric" ? `${money(p)}/kWh` : `${money(p)}/gal`;
    }
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    el.priceTableNote.textContent = state.pricesLive
      ? `As of ${today}. Source: U.S. Dept. of Energy / EIA national averages.`
      : "Live prices unavailable right now — showing typical recent averages. Edit the price to match your local station.";
  }

  function applyPriceForFuelType() {
    const type = el.fuelType.value;
    el.priceUnit.textContent = type === "electric" ? "($/kWh)" : "($/gal)";
    if (!state.prices) return;
    el.price.value = state.prices[type].toFixed(type === "electric" ? 3 : 2);
    el.priceSource.textContent = state.pricesLive
      ? `Today's US average for ${FUEL_LABELS[type].toLowerCase()}. Edit to use your local price.`
      : "Estimated average. Edit to use your local price.";
  }

  // ---------- vehicle selection ----------

  function fallbackYears() {
    const years = [];
    for (let y = new Date().getFullYear() + 1; y >= FIRST_YEAR; y--) years.push({ text: String(y), value: String(y) });
    return years;
  }

  async function loadYears() {
    let years;
    try {
      years = menuItems(await fetchJSON(`${FE_API}/vehicle/menu/year`));
      if (!years.length) throw new Error("empty");
      state.vehicleSource = "api";
    } catch (err) {
      console.warn("FuelEconomy.gov unavailable, using built-in vehicle list:", err);
      state.vehicleSource = "fallback";
      years = fallbackYears();
    }
    setOptions(el.year, years, "Year");
  }

  async function loadMakes(year) {
    resetSelect(el.make, "Loading…");
    resetSelect(el.model, "Select make");
    clearVehicle();
    let makes;
    if (state.vehicleSource === "api") {
      try {
        makes = menuItems(await fetchJSON(`${FE_API}/vehicle/menu/make?year=${encodeURIComponent(year)}`));
      } catch (err) {
        console.warn(err);
        state.vehicleSource = "fallback";
      }
    }
    if (state.vehicleSource === "fallback") {
      makes = Object.keys(window.FALLBACK_VEHICLES).map((m) => ({ text: m, value: m }));
    }
    setOptions(el.make, makes, "Make");
    el.make.disabled = false;
  }

  async function loadModels(year, make) {
    resetSelect(el.model, "Loading…");
    clearVehicle();
    let models;
    if (state.vehicleSource === "api") {
      try {
        models = menuItems(await fetchJSON(
          `${FE_API}/vehicle/menu/model?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}`));
      } catch (err) {
        console.warn(err);
        state.vehicleSource = "fallback";
      }
    }
    if (state.vehicleSource === "fallback") {
      const byModel = window.FALLBACK_VEHICLES[make] || {};
      models = Object.keys(byModel).map((m) => ({ text: m, value: m }));
    }
    setOptions(el.model, models, "Model");
    el.model.disabled = false;
  }

  async function loadTrims(year, make, model) {
    clearVehicle();
    if (state.vehicleSource === "fallback") {
      const v = (window.FALLBACK_VEHICLES[make] || {})[model];
      if (v) setVehicle({ label: `${year} ${make} ${model}`, mpg: v.mpg, kwhPer100: v.kwh, fuel: v.fuel, approx: true });
      return;
    }
    try {
      const trims = menuItems(await fetchJSON(
        `${FE_API}/vehicle/menu/options?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`));
      if (!trims.length) throw new Error("No trims");
      setOptions(el.trim, trims);
      el.trimField.hidden = trims.length < 2;
      await loadVehicle(el.trim.value);
    } catch (err) {
      console.warn(err);
      el.vehicleInfo.hidden = false;
      el.vehicleInfo.textContent = "Couldn't load fuel economy for this car. Enter its MPG manually below.";
    }
  }

  async function loadVehicle(id) {
    if (!id) return;
    el.vehicleInfo.hidden = false;
    el.vehicleInfo.textContent = "Looking up fuel economy…";
    try {
      const v = await fetchJSON(`${FE_API}/vehicle/${encodeURIComponent(id)}`);
      const fuel = mapFuelType(v.fuelType1);
      setVehicle({
        id,
        label: `${v.year} ${v.make} ${v.model}`,
        mpg: parseFloat(v.comb08) || null,
        kwhPer100: fuel === "electric" ? parseFloat(v.combE) || null : null,
        fuel,
      });
    } catch (err) {
      console.warn(err);
      state.vehicle = null;
      el.vehicleInfo.textContent = "Couldn't load fuel economy for this car. Enter its MPG manually below.";
    }
  }

  function mapFuelType(fuelType1 = "") {
    const f = fuelType1.toLowerCase();
    if (f.includes("electric")) return "electric";
    if (f.includes("premium")) return "premium";
    if (f.includes("midgrade")) return "midgrade";
    if (f.includes("diesel")) return "diesel";
    return "regular";
  }

  function setVehicle(v) {
    state.vehicle = v;
    const economy = v.fuel === "electric"
      ? `${num(v.kwhPer100, 0)} kWh/100 mi (${num(100 * KWH_PER_GALLON_EQUIV / v.kwhPer100, 0)} MPGe)`
      : `${num(v.mpg, 0)} MPG combined`;
    el.vehicleInfo.hidden = false;
    el.vehicleInfo.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = v.label;
    el.vehicleInfo.append("🚗 ", strong, ` — ${economy} · ${FUEL_LABELS[v.fuel].toLowerCase()} fuel`,
      v.approx ? " (approximate)" : "");
    if (el.fuelType.value !== v.fuel) {
      el.fuelType.value = v.fuel;
      applyPriceForFuelType();
    }
  }

  function clearVehicle() {
    state.vehicle = null;
    el.vehicleInfo.hidden = true;
    el.trimField.hidden = true;
    el.trim.innerHTML = "";
  }

  function resetSelect(select, placeholder) {
    setOptions(select, [], placeholder);
    select.disabled = true;
  }

  // ---------- place autocomplete ----------

  function placeLabel(p) {
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ");
    const parts = [name, p.city !== name ? p.city : null, p.state, p.country].filter(Boolean);
    return [...new Set(parts)].join(", ");
  }

  async function geocode(query, limit = 5) {
    const url = `${GEOCODE_API}?q=${encodeURIComponent(query)}&limit=${limit}&lang=en`;
    const data = await fetchJSON(url, { timeout: 8000 });
    return (data.features || []).map((f) => ({
      label: placeLabel(f.properties),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
    }));
  }

  function setupAutocomplete(input, key) {
    const list = input.parentElement.querySelector(".suggestions");
    let timer = null;
    let results = [];
    let active = -1;
    let requestId = 0;

    const close = () => { list.innerHTML = ""; results = []; active = -1; };

    const choose = (i) => {
      const place = results[i];
      if (!place) return;
      state.places[key] = place;
      input.value = place.label;
      close();
    };

    const render = () => {
      list.innerHTML = "";
      results.forEach((r, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        const [first, ...rest] = r.label.split(", ");
        li.textContent = first;
        if (rest.length) {
          const small = document.createElement("small");
          small.textContent = rest.join(", ");
          li.append(small);
        }
        if (i === active) li.classList.add("active");
        li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
        list.append(li);
      });
    };

    input.addEventListener("input", () => {
      state.places[key] = null;
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) { close(); return; }
      timer = setTimeout(async () => {
        const id = ++requestId;
        try {
          const found = await geocode(q);
          if (id !== requestId) return;
          results = found;
          active = -1;
          render();
        } catch (err) {
          console.warn("Autocomplete failed:", err);
        }
      }, 300);
    });

    input.addEventListener("keydown", (e) => {
      if (!results.length) return;
      if (e.key === "ArrowDown") { active = (active + 1) % results.length; render(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = (active - 1 + results.length) % results.length; render(); e.preventDefault(); }
      else if (e.key === "Enter" && active >= 0) { choose(active); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });

    input.addEventListener("blur", () => setTimeout(close, 150));
  }

  async function resolvePlace(key, input) {
    if (state.places[key]) return state.places[key];
    const q = input.value.trim();
    if (!q) throw new Error(`Please enter a ${key === "from" ? "starting location" : "destination"}.`);
    let found;
    try {
      found = await geocode(q, 1);
    } catch {
      throw new Error("Location search is unavailable right now. Please try again in a moment.");
    }
    if (!found.length) throw new Error(`We couldn't find "${q}". Try adding the city and state.`);
    state.places[key] = found[0];
    return found[0];
  }

  // ---------- routing ----------

  async function getRoute(a, b) {
    try {
      const url = `${ROUTE_API}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
      const data = await fetchJSON(url, { timeout: 15000 });
      const route = data.routes && data.routes[0];
      if (data.code !== "Ok" || !route) throw new Error(data.message || data.code || "No route");
      return {
        miles: route.distance / METERS_PER_MILE,
        seconds: route.duration,
        coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
        estimated: false,
      };
    } catch (err) {
      console.warn("Routing failed, estimating distance:", err);
      // Road distance is typically ~20-30% longer than straight-line distance.
      const miles = haversineMiles(a, b) * 1.25;
      return { miles, seconds: (miles / 55) * 3600, coords: [[a.lat, a.lon], [b.lat, b.lon]], estimated: true };
    }
  }

  function drawMap(route, a, b) {
    if (!window.L) return;
    if (!state.map) {
      state.map = L.map(el.map, { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(state.map);
    }
    if (state.mapLayer) state.mapLayer.remove();
    const line = L.polyline(route.coords, { color: "#0f766e", weight: 5, dashArray: route.estimated ? "8 8" : null });
    state.mapLayer = L.featureGroup([
      line,
      L.marker([a.lat, a.lon]).bindPopup("Start"),
      L.marker([b.lat, b.lon]).bindPopup("Destination"),
    ]).addTo(state.map);
    state.map.invalidateSize();
    state.map.fitBounds(state.mapLayer.getBounds(), { padding: [20, 20] });
  }

  // ---------- calculation ----------

  function getEconomy() {
    const manual = parseFloat(el.manualMpg.value);
    const fuel = el.fuelType.value;
    if (manual > 0) {
      return fuel === "electric"
        ? { kwhPer100: (100 * KWH_PER_GALLON_EQUIV) / manual, mpg: manual, manual: true }
        : { mpg: manual, manual: true };
    }
    const v = state.vehicle;
    if (!v) return null;
    if (fuel === "electric") {
      if (v.kwhPer100) return { kwhPer100: v.kwhPer100, mpg: (100 * KWH_PER_GALLON_EQUIV) / v.kwhPer100 };
      return null;
    }
    return v.mpg ? { mpg: v.mpg } : null;
  }

  async function calculate(e) {
    if (e) e.preventDefault();
    showError("");

    const economy = getEconomy();
    if (!economy) {
      showError(el.fuelType.value === "electric" && state.vehicle
        ? "This vehicle has no electric rating. Choose its fuel type or enter MPG manually."
        : "Please select your car (year, make and model) or enter its MPG manually.");
      return;
    }
    const price = parseFloat(el.price.value);
    if (!(price > 0)) { showError("Please enter a fuel price."); return; }

    el.calcBtn.disabled = true;
    el.calcBtn.textContent = "Calculating…";
    try {
      const [a, b] = await Promise.all([resolvePlace("from", el.from), resolvePlace("to", el.to)]);
      el.from.value = a.label;
      el.to.value = b.label;
      document.querySelectorAll(".suggestions").forEach((ul) => { ul.innerHTML = ""; });
      const route = await getRoute(a, b);

      const trips = el.roundTrip.checked ? 2 : 1;
      const miles = route.miles * trips;
      const fuel = el.fuelType.value;
      const isEV = fuel === "electric";
      const used = isEV ? (miles * economy.kwhPer100) / 100 : miles / economy.mpg;
      const cost = used * price;
      const people = parseInt(el.people.value, 10);

      el.routeLine.textContent = `${a.label} → ${b.label}${trips === 2 ? " (round trip)" : ""}`;
      el.totalCost.textContent = money(cost);
      el.perPerson.textContent = people > 1 ? `${money(cost / people)} per person (${people} people)` : "";
      el.rDistance.textContent = `${num(miles, 0)} mi`;
      el.rTime.textContent = formatDuration(route.seconds * trips);
      el.rFuel.textContent = isEV ? `${num(used, 1)} kWh` : `${num(used, 1)} gal`;
      el.rMpg.textContent = isEV
        ? `${num(economy.kwhPer100, 0)} kWh/100 mi`
        : `${num(economy.mpg, economy.mpg % 1 ? 1 : 0)} MPG${economy.manual ? " (manual)" : ""}`;
      el.rPrice.textContent = isEV ? `${money(price)}/kWh` : `${money(price)}/gal`;
      el.rCpm.textContent = `${num((cost / miles) * 100, 1)}¢`;
      el.routeNote.hidden = !route.estimated;
      el.routeNote.textContent = route.estimated
        ? "Driving directions were unavailable, so distance is estimated from a straight line (+25%)."
        : "";

      el.results.hidden = false;
      drawMap(route, a, b);
      history.replaceState(null, "", `?${shareParams().toString()}`);
      if (window.matchMedia("(max-width: 860px)").matches) el.results.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      showError(err.message || "Something went wrong. Please try again.");
    } finally {
      el.calcBtn.disabled = false;
      el.calcBtn.textContent = "Calculate trip cost";
    }
  }

  // ---------- shareable links ----------

  function shareParams() {
    const p = new URLSearchParams();
    p.set("from", el.from.value);
    p.set("to", el.to.value);
    if (el.roundTrip.checked) p.set("rt", "1");
    if (el.year.value) p.set("year", el.year.value);
    if (el.make.value) p.set("make", el.make.value);
    if (el.model.value) p.set("model", el.model.value);
    if (el.trim.value) p.set("trim", el.trim.value);
    if (el.manualMpg.value) p.set("mpg", el.manualMpg.value);
    p.set("fuel", el.fuelType.value);
    p.set("price", el.price.value);
    if (el.people.value !== "1") p.set("people", el.people.value);
    return p;
  }

  async function restoreFromUrl() {
    const p = new URLSearchParams(location.search);
    if (!p.get("from") || !p.get("to")) return;
    el.from.value = p.get("from");
    el.to.value = p.get("to");
    el.roundTrip.checked = p.get("rt") === "1";
    if (p.get("people")) { el.people.value = p.get("people"); updatePeople(); }
    if (p.get("mpg")) el.manualMpg.value = p.get("mpg");

    const pick = (select, value) => {
      if (value && [...select.options].some((o) => o.value === value)) { select.value = value; return true; }
      return false;
    };
    if (pick(el.year, p.get("year"))) {
      await loadMakes(el.year.value);
      if (pick(el.make, p.get("make"))) {
        await loadModels(el.year.value, el.make.value);
        if (pick(el.model, p.get("model"))) {
          await loadTrims(el.year.value, el.make.value, el.model.value);
          if (pick(el.trim, p.get("trim"))) await loadVehicle(el.trim.value);
        }
      }
    }
    if (p.get("fuel") && FUEL_LABELS[p.get("fuel")]) { el.fuelType.value = p.get("fuel"); applyPriceForFuelType(); }
    if (p.get("price")) el.price.value = p.get("price");
    await calculate();
  }

  // ---------- wiring ----------

  function updatePeople() {
    const n = el.people.value;
    el.peopleOut.textContent = n;
    el.peopleWord.textContent = n === "1" ? "person" : "people";
  }

  el.year.addEventListener("change", () => el.year.value ? loadMakes(el.year.value) : resetSelect(el.make, "Select year"));
  el.make.addEventListener("change", () => el.make.value && loadModels(el.year.value, el.make.value));
  el.model.addEventListener("change", () => el.model.value && loadTrims(el.year.value, el.make.value, el.model.value));
  el.trim.addEventListener("change", () => loadVehicle(el.trim.value));
  el.fuelType.addEventListener("change", applyPriceForFuelType);
  el.people.addEventListener("input", updatePeople);
  el.form.addEventListener("submit", calculate);
  el.shareBtn.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?${shareParams().toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      el.shareBtn.textContent = "Link copied!";
    } catch {
      prompt("Copy this link:", url);
    }
    setTimeout(() => { el.shareBtn.textContent = "Copy shareable link"; }, 2000);
  });

  setupAutocomplete(el.from, "from");
  setupAutocomplete(el.to, "to");
  $("year-now").textContent = new Date().getFullYear();

  Promise.all([loadPrices(), loadYears()]).then(restoreFromUrl);
})();
