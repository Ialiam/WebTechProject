(() => {
  "use strict";

  const CONFIG = window.TRIPFUEL_CONFIG || {};
  const FE_API = "https://www.fueleconomy.gov/ws/rest";
  const GEOCODE_API = "https://photon.komoot.io/api/";
  const ROUTE_API = "https://router.project-osrm.org/route/v1/driving/";
  const PLACES_API = "https://places.googleapis.com/v1/places:searchNearby";
  const KWH_PER_GALLON_EQUIV = 33.7;
  const METERS_PER_MILE = 1609.344;
  const KM_PER_MILE = 1.609344;
  const LITRES_PER_GALLON = 3.785411784;
  const MPG_TO_L100KM = 235.214583; // L/100 km = MPG_TO_L100KM / MPG
  const FIRST_YEAR = 1984;
  const STATION_CACHE_MS = 30 * 60 * 1000;
  const STALE_PRICE_MS = 7 * 24 * 60 * 60 * 1000;
  const CITY_PRICE_RADIUS_KM = 100;

  const $ = (id) => document.getElementById(id);
  const el = {
    form: $("trip-form"), country: $("country"), from: $("from"), to: $("to"), roundTrip: $("round-trip"),
    unitRadios: document.querySelectorAll('input[name="units"]'),
    priceModeRadios: document.querySelectorAll('input[name="price-mode"]'),
    year: $("year"), make: $("make"), model: $("model"), trim: $("trim"), trimField: $("trim-field"),
    vehicleInfo: $("vehicle-info"), manualMpg: $("manual-mpg"), manualLabel: $("manual-label"),
    fuelType: $("fuel-type"), price: $("price"), priceUnit: $("price-unit"), priceSource: $("price-source"),
    people: $("people"), peopleOut: $("people-out"), peopleWord: $("people-word"),
    calcBtn: $("calc-btn"), formError: $("form-error"),
    results: $("results"), totalLabel: document.querySelector(".big-number .label"), routeLine: $("route-line"), totalCost: $("total-cost"), perPerson: $("per-person"),
    rDistance: $("r-distance"), rTime: $("r-time"), rFuel: $("r-fuel"), rMpg: $("r-mpg"),
    rPrice: $("r-price"), rCpm: $("r-cpm"), rCpmLabel: $("r-cpm-label"), routeNote: $("route-note"), map: $("map"),
    shareBtn: $("share-btn"), priceCardTitle: $("price-card-title"), priceTable: $("price-table"),
    priceTableNote: $("price-table-note"),
  };

  const state = {
    units: "imperial",      // "imperial" (mi, MPG, gal) or "metric" (km, L/100 km, L)
    unitsChosen: false,     // true once the user picks units, so we stop auto-switching
    country: guessCountry(),
    currency: "USD",
    priceUnit: "gal",       // unit of the number currently in the price field: "gal", "L" or "kWh"
    priceEdited: false,     // true in "Type the pump price" mode
    restoring: false,
    vehicleSource: "api",   // "api" or "fallback" (FuelEconomy.gov unreachable)
    vehicle: null,          // { label, mpg, kwhPer100, fuel }
    usPrices: null,         // US national averages, USD per gallon (per kWh for electric)
    usPricesLive: false,
    stations: null,         // nearby station prices, see fetchStations()
    cityPrices: null,       // daily city averages from data/prices.json
    startPlaceTask: null,
    places: { from: null, to: null }, // { label, lat, lon, country }
    lastTrip: null,
    map: null,
    mapLayer: null,
  };

  const FUEL_LABELS = {
    regular: "Regular", midgrade: "Midgrade", premium: "Premium",
    diesel: "Diesel", e85: "E85", electric: "Electricity",
  };

  // Google Places fuel types → our fuel types. The first match per station wins.
  const FUEL_FROM_GOOGLE = {
    REGULAR_UNLEADED: "regular", SP91: "regular", SP95: "regular", SP95_E10: "regular",
    MIDGRADE: "midgrade",
    PREMIUM: "premium", SP98: "premium", SP99: "premium", SP100: "premium",
    DIESEL: "diesel", E85: "e85",
  };

  const EURO = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"];
  const CURRENCIES = {
    US: "USD", CA: "CAD", GB: "GBP", AU: "AUD", NZ: "NZD", IN: "INR", PK: "PKR", BD: "BDT", AE: "AED",
    SA: "SAR", QA: "QAR", MX: "MXN", BR: "BRL", ZA: "ZAR", CH: "CHF", JP: "JPY", SE: "SEK", NO: "NOK",
    DK: "DKK", PL: "PLN", TR: "TRY", PH: "PHP", MY: "MYR", SG: "SGD", NG: "NGN", KE: "KES", EG: "EGP",
    ...Object.fromEntries(EURO.map((c) => [c, "EUR"])),
  };
  const currencyFor = (country) => CURRENCIES[country] || "USD";
  // The US measures in miles and gallons; Canada and almost everywhere else in km and litres.
  const unitsFor = (country) => (country === "US" ? "imperial" : "metric");

  // ---------- helpers ----------

  function guessCountry() {
    const lang = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    const m = lang.match(/[-_]([A-Za-z]{2})\b/);
    return m ? m[1].toUpperCase() : "US";
  }

  async function fetchJSON(url, { timeout = 12000, headers = {}, method = "GET", body } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method, body, headers: { Accept: "application/json", ...headers }, signal: ctrl.signal,
      });
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

  function money(n, digits = 2, currency = state.currency) {
    return n.toLocaleString("en-US", {
      style: "currency", currency, currencyDisplay: "narrowSymbol",
      minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits,
    });
  }
  const num = (n, d = 1) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

  const metric = () => state.units === "metric";
  const fuelUnit = (fuel = el.fuelType.value) => (fuel === "electric" ? "kWh" : metric() ? "L" : "gal");

  function convertPrice(value, from, to) {
    if (from === to || from === "kWh" || to === "kWh") return value;
    return from === "gal" ? value / LITRES_PER_GALLON : value * LITRES_PER_GALLON;
  }

  // Price per gallon/litre with 3 decimals where pumps show them (e.g. $1.729/L).
  const formatPrice = (value, unit, currency = state.currency) =>
    `${money(value, unit === "gal" ? 2 : 3, currency)}/${unit}`;

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

  const median = (values) => {
    const v = [...values].sort((x, y) => x - y);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  };

  function showError(msg) {
    el.formError.textContent = msg;
    el.formError.hidden = !msg;
  }

  // ---------- country ----------

  function fillCountries() {
    let names;
    try { names = new Intl.DisplayNames(["en"], { type: "region" }); } catch { names = null; }
    const name = (c) => (names && names.of(c)) || c;
    const pinned = ["US", "CA"];
    const rest = Object.keys(CURRENCIES).filter((c) => !pinned.includes(c))
      .map((c) => [c, name(c)]).sort((a, b) => a[1].localeCompare(b[1]));
    el.country.innerHTML = "";
    for (const [code, label] of [...pinned.map((c) => [c, name(c)]), ...rest]) {
      el.country.add(new Option(`${label} (${currencyFor(code)})`, code));
    }
    if (!CURRENCIES[state.country]) state.country = "US";
    el.country.value = state.country;
    updatePlaceholders();
  }

  const PLACE_EXAMPLES = {
    US: ["Dallas, TX", "Houston, TX"],
    CA: ["Sudbury, ON", "Toronto, ON"],
  };

  function updatePlaceholders() {
    const [from, to] = PLACE_EXAMPLES[state.country] || [];
    el.from.placeholder = from ? `City or address, e.g. ${from}` : "City or address";
    el.to.placeholder = to ? `City or address, e.g. ${to}` : "City or address";
  }

  // Switch country: its units, currency and fuel prices follow.
  function setCountry(code) {
    if (!CURRENCIES[code]) return;
    const changed = code !== state.country;
    state.country = code;
    el.country.value = code;
    updatePlaceholders();
    if (!changed) return;
    state.unitsChosen = false;
    setUnits(unitsFor(code));
    if (state.priceEdited && !state.restoring) state.currency = currencyFor(code);
    const from = state.places.from;
    if (from && (from.country || "").toUpperCase() !== code) state.stations = null;
    applyAutoPrice();
    renderPriceCard();
  }

  // ---------- units ----------

  function setUnits(units) {
    if (units === state.units) return;
    const manual = readManualEconomy();
    state.units = units;
    for (const r of el.unitRadios) r.checked = r.value === units;
    const unit = fuelUnit();
    if (el.price.value && state.priceUnit !== unit) {
      setPriceField(convertPrice(parseFloat(el.price.value), state.priceUnit, unit), unit);
    }
    state.priceUnit = unit;
    if (manual) writeManualEconomy(manual);
    updateUnitLabels();
    if (state.vehicle) renderVehicleInfo();
    if (state.lastTrip) renderResults();
    renderPriceCard();
  }

  function updateUnitLabels() {
    const fuel = el.fuelType.value;
    const unitWord = { gal: "gallon", L: "litre", kWh: "kWh" }[fuelUnit(fuel)];
    el.priceUnit.textContent = `(${state.currency === "USD" ? "$" : state.currency} per ${unitWord})`;
    const ev = fuel === "electric";
    const [label, example] = metric()
      ? (ev ? ["Energy use (kWh/100 km)", "e.g. 17"] : ["Fuel consumption (L/100 km)", "e.g. 8.5"])
      : (ev ? ["Efficiency (MPGe)", "e.g. 120"] : ["Combined MPG", "e.g. 28"]);
    el.manualLabel.textContent = label;
    el.manualMpg.placeholder = example;
  }

  // Manual economy in the units shown → { mpg } or { kwhPer100mi }.
  function readManualEconomy() {
    const x = parseFloat(el.manualMpg.value);
    if (!(x > 0)) return null;
    const ev = el.fuelType.value === "electric";
    if (metric()) return ev ? { kwhPer100mi: x * KM_PER_MILE } : { mpg: MPG_TO_L100KM / x };
    return ev ? { kwhPer100mi: (100 * KWH_PER_GALLON_EQUIV) / x } : { mpg: x };
  }

  function writeManualEconomy(e) {
    let x;
    if (e.kwhPer100mi) x = metric() ? e.kwhPer100mi / KM_PER_MILE : (100 * KWH_PER_GALLON_EQUIV) / e.kwhPer100mi;
    else x = metric() ? MPG_TO_L100KM / e.mpg : e.mpg;
    el.manualMpg.value = Math.round(x * 10) / 10;
  }

  // ---------- fuel prices ----------

  async function loadUsPrices() {
    try {
      const data = await fetchJSON(`${FE_API}/fuelprices`);
      const prices = {};
      for (const key of Object.keys(FUEL_LABELS)) {
        const v = parseFloat(data[key]);
        if (v > 0) prices[key] = v;
      }
      if (!prices.regular) throw new Error("No price data");
      state.usPrices = { ...window.FALLBACK_PRICES, ...prices };
      state.usPricesLive = true;
    } catch (err) {
      console.warn("Fuel price feed unavailable, using fallback prices:", err);
      state.usPrices = { ...window.FALLBACK_PRICES };
      state.usPricesLive = false;
    }
  }

  // Daily city average prices, collected by .github/workflows/update-prices.yml.
  async function loadCityPrices() {
    try {
      state.cityPrices = await fetchJSON("data/prices.json", { timeout: 8000 });
    } catch (err) {
      console.warn("City fuel prices unavailable:", err);
      state.cityPrices = null;
    }
  }

  const shortDate = (iso) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Price data for the selected country: { currency, unit, source, national, cities }.
  const countryPrices = () => (state.cityPrices && state.cityPrices.countries || {})[state.country] || null;

  // The priced city closest to the starting point, if one is close enough.
  function nearestPricedCity() {
    const data = countryPrices();
    const from = state.places.from;
    if (!data || !from) return null;
    let best = null;
    for (const city of data.cities || []) {
      const km = haversineMiles(from, city) * KM_PER_MILE;
      if (km <= CITY_PRICE_RADIUS_KM && (!best || km < best.km)) best = { ...city, km };
    }
    return best;
  }

  // Best automatic price for a fuel type: nearby stations, then the nearest
  // city's daily average, then national averages.
  // Returns { value, unit, currency, note, live } or null.
  function autoPrice(fuel) {
    const st = state.stations;
    if (st && fuel !== "electric") {
      const offers = st.list.filter((s) => s.prices[fuel]);
      if (offers.length) {
        const cheapest = offers.reduce((a, b) => (b.prices[fuel].value < a.prices[fuel].value ? b : a));
        const n = offers.length;
        return {
          value: median(offers.map((s) => s.prices[fuel].value)),
          unit: st.unit, currency: st.currency, live: true,
          note: n > 1
            ? `Today's typical price at ${n} stations near ${st.label}. Cheapest: ${cheapest.name}, ${formatPrice(convertPrice(cheapest.prices[fuel].value, st.unit, fuelUnit(fuel)), fuelUnit(fuel), st.currency)}.`
            : `Today's price at ${cheapest.name} near ${st.label}.`,
        };
      }
    }
    const data = countryPrices();
    const city = nearestPricedCity();
    if (city && city.prices[fuel]) {
      return {
        value: city.prices[fuel], unit: data.unit, currency: data.currency, live: true,
        note: `Average price in ${city.name} on ${shortDate(city.date)}, from ${data.source}.`,
      };
    }
    if (data && data.national && data.national.prices[fuel]) {
      return {
        value: data.national.prices[fuel], unit: data.unit, currency: data.currency, live: true,
        note: `${data.national.name} average on ${shortDate(data.national.date)}, from ${data.source}.`,
      };
    }
    if (state.country === "US" && state.usPrices && state.usPrices[fuel]) {
      return {
        value: state.usPrices[fuel], unit: fuel === "electric" ? "kWh" : "gal", currency: "USD",
        live: state.usPricesLive,
        note: state.usPricesLive
          ? `This week's US average for ${FUEL_LABELS[fuel].toLowerCase()}.`
          : "Typical US average. Live prices are unavailable right now.",
      };
    }
    const ca = window.FALLBACK_PRICES_CA || {};
    if (state.country === "CA" && ca[fuel]) {
      return {
        value: ca[fuel], unit: fuel === "electric" ? "kWh" : "L", currency: "CAD", live: false,
        note: "Rough Canadian average. Live prices are unavailable right now.",
      };
    }
    return null;
  }

  function setPriceField(value, unit) {
    el.price.value = value.toFixed(unit === "gal" ? 2 : 3);
    state.priceUnit = unit;
  }

  // "auto": fill in today's price for the route. "manual": the user types the pump price.
  function setPriceMode(mode) {
    state.priceEdited = mode === "manual";
    for (const r of el.priceModeRadios) r.checked = r.value === mode;
    el.priceSource.classList.remove("price-hint-ok");
    if (mode === "auto") {
      applyAutoPrice();
    } else {
      state.priceUnit = fuelUnit();
      el.priceSource.textContent = "Type the price shown at the pump.";
    }
  }

  function applyAutoPrice() {
    const fuel = el.fuelType.value;
    if (state.priceEdited) {
      updateUnitLabels();
      return;
    }
    const auto = autoPrice(fuel);
    if (auto) {
      state.currency = auto.currency;
      setPriceField(convertPrice(auto.value, auto.unit, fuelUnit(fuel)), fuelUnit(fuel));
      el.priceSource.textContent = auto.note;
      el.priceSource.classList.toggle("price-hint-ok", !!(state.stations && auto.live));
    } else {
      state.currency = currencyFor(state.country);
      el.price.value = "";
      state.priceUnit = fuelUnit(fuel);
      el.priceSource.textContent = "We don't have today's prices for this country yet. Type the price shown at the pump.";
      el.priceSource.classList.remove("price-hint-ok");
    }
    updateUnitLabels();
  }

  // Today's posted prices at gas stations near a place, from Google Places.
  // Returns { label, list: [{ name, address, km, prices: { regular: { value } } }], currency, unit } or null.
  async function fetchStations(place) {
    const key = CONFIG.googleMapsApiKey;
    if (!key) return null;
    const cacheKey = `tfc-stations:${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.t < STATION_CACHE_MS) return cached.v;
    } catch { /* storage unavailable */ }

    let data;
    try {
      data = await fetchJSON(PLACES_API, {
        method: "POST",
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.displayName,places.shortFormattedAddress,places.location,places.fuelOptions",
        },
        body: JSON.stringify({
          includedTypes: ["gas_station"],
          maxResultCount: 20,
          rankPreference: "DISTANCE",
          locationRestriction: {
            circle: { center: { latitude: place.lat, longitude: place.lon }, radius: CONFIG.stationSearchRadius || 8000 },
          },
        }),
      });
    } catch (err) {
      console.warn("Nearby station prices unavailable:", err);
      return null;
    }

    const list = [];
    let currency = null;
    for (const p of data.places || []) {
      const prices = {};
      for (const fp of (p.fuelOptions && p.fuelOptions.fuelPrices) || []) {
        const fuel = FUEL_FROM_GOOGLE[fp.type];
        if (!fuel || prices[fuel] || !fp.price) continue;
        if (fp.updateTime && Date.now() - Date.parse(fp.updateTime) > STALE_PRICE_MS) continue;
        const value = Number(fp.price.units || 0) + (fp.price.nanos || 0) / 1e9;
        if (!(value > 0)) continue;
        prices[fuel] = { value, updated: fp.updateTime };
        currency = currency || fp.price.currencyCode;
      }
      if (!Object.keys(prices).length || !p.location) continue;
      list.push({
        name: (p.displayName && p.displayName.text) || "Gas station",
        address: p.shortFormattedAddress || "",
        km: haversineMiles(place, { lat: p.location.latitude, lon: p.location.longitude }) * KM_PER_MILE,
        prices,
      });
    }
    if (!list.length) return null;

    const country = (place.country || state.country).toUpperCase();
    const result = {
      label: place.label.split(", ")[0],
      list,
      currency: currency || currencyFor(country),
      unit: country === "US" ? "gal" : "L", // Google lists prices in the local pump unit
    };
    try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), v: result })); } catch { /* ignore */ }
    return result;
  }

  // Called whenever the starting point changes: pick units/currency for that
  // country and look up prices near it.
  async function onStartPlace(place) {
    if (place.country) setCountry(place.country.toUpperCase());
    state.stations = null;
    applyAutoPrice();
    renderPriceCard();

    const stations = await fetchStations(place);
    if (state.places.from !== place) return; // user moved on
    state.stations = stations;
    applyAutoPrice();
    renderPriceCard();
  }

  function renderPriceCard() {
    const fuel = el.fuelType.value;
    const unit = fuelUnit(fuel);
    const st = state.stations;
    el.priceTable.innerHTML = "";

    const addRow = (label, value, cls) => {
      const row = el.priceTable.insertRow();
      if (cls) row.className = cls;
      const name = row.insertCell();
      if (typeof label === "string") name.textContent = label;
      else name.append(...label);
      row.insertCell().textContent = value;
      return row;
    };

    const nearby = st && st.list.filter((s) => s.prices[fuel]).sort((a, b) => a.prices[fuel].value - b.prices[fuel].value);
    if (nearby && nearby.length) {
      el.priceCardTitle.textContent = `${FUEL_LABELS[fuel]} prices near ${st.label}`;
      nearby.slice(0, 8).forEach((s, i) => {
        const name = document.createElement("span");
        name.className = "station-name";
        name.textContent = s.name;
        const small = document.createElement("small");
        const dist = metric() ? `${num(s.km, 1)} km` : `${num(s.km / KM_PER_MILE, 1)} mi`;
        small.textContent = [s.address, dist].filter(Boolean).join(" · ");
        name.append(small);
        addRow([name], formatPrice(convertPrice(s.prices[fuel].value, st.unit, unit), unit, st.currency), i === 0 ? "cheapest" : "");
      });
      el.priceTableNote.textContent = `Posted prices from Google Maps, updated in the last few days. Prices in ${st.currency}.`;
      return;
    }

    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const table = (prices, currency, baseUnit) => {
      for (const [key, label] of Object.entries(FUEL_LABELS)) {
        if (!prices[key]) continue;
        const u = key === "electric" ? "kWh" : metric() ? "L" : "gal";
        addRow(label, formatPrice(convertPrice(prices[key], key === "electric" ? "kWh" : baseUnit, u), u, currency));
      }
    };

    const data = countryPrices();
    const city = nearestPricedCity();
    const avg = city || (data && data.national);
    if (avg) {
      el.priceCardTitle.textContent = `Fuel prices in ${avg.name}`;
      table(avg.prices, data.currency, data.unit);
      el.priceTableNote.textContent = `Average pump prices on ${shortDate(avg.date)}. Source: ${data.source}.`
        + (city ? "" : " Enter your starting city to see its local average.");
    } else if (state.country === "CA") {
      el.priceCardTitle.textContent = "Typical fuel prices (Canada)";
      table(window.FALLBACK_PRICES_CA || {}, "CAD", "L");
      el.priceTableNote.textContent = "Rough national averages in CAD. Prices vary by city, so edit the price in the form to match your station.";
    } else if (state.country === "US" || !state.usPrices) {
      el.priceCardTitle.textContent = "Today's average fuel prices (US)";
      if (state.usPrices) table(state.usPrices, "USD", "gal");
      el.priceTableNote.textContent = state.usPricesLive
        ? `As of ${today}. Source: U.S. Dept. of Energy / EIA national averages.`
        : "Live prices unavailable right now, so these are typical recent averages. Edit the price to match your local station.";
    } else {
      el.priceCardTitle.textContent = "Fuel prices";
      addRow("Enter the price at your local station in the form.", "");
      el.priceTableNote.textContent = "";
    }
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
      el.vehicleInfo.textContent = "Couldn't load fuel economy for this car. Enter it manually below.";
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
      el.vehicleInfo.textContent = "Couldn't load fuel economy for this car. Enter it manually below.";
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

  function economyText(v) {
    if (v.fuel === "electric") {
      return metric()
        ? `${num(v.kwhPer100 / KM_PER_MILE, 1)} kWh/100 km`
        : `${num(v.kwhPer100, 0)} kWh/100 mi (${num((100 * KWH_PER_GALLON_EQUIV) / v.kwhPer100, 0)} MPGe)`;
    }
    return metric()
      ? `${num(MPG_TO_L100KM / v.mpg, 1)} L/100 km (${num(v.mpg, 0)} MPG)`
      : `${num(v.mpg, 0)} MPG combined`;
  }

  function renderVehicleInfo() {
    const v = state.vehicle;
    el.vehicleInfo.hidden = false;
    el.vehicleInfo.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = v.label;
    el.vehicleInfo.append("🚗 ", strong, ` — ${economyText(v)} · ${FUEL_LABELS[v.fuel].toLowerCase()} fuel`,
      v.approx ? " (approximate)" : "");
  }

  function setVehicle(v) {
    state.vehicle = v;
    renderVehicleInfo();
    if (el.fuelType.value !== v.fuel) {
      el.fuelType.value = v.fuel;
      onFuelTypeChange();
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

  function onFuelTypeChange() {
    applyAutoPrice();
    renderPriceCard();
  }

  // ---------- place autocomplete ----------

  function placeLabel(p) {
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ");
    const parts = [name, p.city !== name ? p.city : null, p.state, p.country].filter(Boolean);
    return [...new Set(parts)].join(", ");
  }

  // Places matching the query, those in the selected country first.
  async function geocode(query, limit = 5) {
    const url = `${GEOCODE_API}?q=${encodeURIComponent(query)}&limit=10&lang=en`;
    const data = await fetchJSON(url, { timeout: 8000 });
    const features = data.features || [];
    const inCountry = (f) => (f.properties.countrycode || "").toUpperCase() === state.country;
    const sorted = [...features.filter(inCountry), ...features.filter((f) => !inCountry(f))];
    return sorted.slice(0, limit).map((f) => ({
      label: placeLabel(f.properties),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      country: f.properties.countrycode || "",
    }));
  }

  function setPlace(key, place) {
    state.places[key] = place;
    if (key === "from") state.startPlaceTask = onStartPlace(place);
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
      input.value = place.label;
      close();
      setPlace(key, place);
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
    if (!found.length) throw new Error(`We couldn't find "${q}". Try adding the city and province or state.`);
    setPlace(key, found[0]);
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

  // Returns { mpg } or { kwhPer100mi }, plus `manual` when typed in by the user.
  function getEconomy() {
    const manual = readManualEconomy();
    if (manual) return { ...manual, manual: true };
    const v = state.vehicle;
    if (!v) return null;
    if (el.fuelType.value === "electric") return v.kwhPer100 ? { kwhPer100mi: v.kwhPer100 } : null;
    return v.mpg ? { mpg: v.mpg } : null;
  }

  async function calculate(e) {
    if (e) e.preventDefault();
    showError("");

    const economy = getEconomy();
    if (!economy) {
      showError(el.fuelType.value === "electric" && state.vehicle
        ? "This vehicle has no electric rating. Choose its fuel type or enter its fuel economy manually."
        : "Please select your car (year, make and model) or enter its fuel economy manually.");
      return;
    }

    el.calcBtn.disabled = true;
    el.calcBtn.textContent = "Calculating…";
    try {
      const [a, b] = await Promise.all([resolvePlace("from", el.from), resolvePlace("to", el.to)]);
      await state.startPlaceTask; // wait for nearby prices before using the price
      el.from.value = a.label;
      el.to.value = b.label;
      document.querySelectorAll(".suggestions").forEach((ul) => { ul.innerHTML = ""; });

      const price = parseFloat(el.price.value);
      if (!(price > 0)) throw new Error("Please enter the fuel price at your local station.");

      const route = await getRoute(a, b);
      const trips = el.roundTrip.checked ? 2 : 1;
      const miles = route.miles * trips;
      const isEV = el.fuelType.value === "electric";
      // Work in miles and gallons (or kWh) internally; convert only for display.
      const pricePerUnit = isEV ? price : convertPrice(price, state.priceUnit, "gal");
      const used = isEV ? (miles * economy.kwhPer100mi) / 100 : miles / economy.mpg;

      state.lastTrip = {
        a, b, trips, miles, isEV, economy, used, pricePerUnit,
        seconds: route.seconds * trips,
        estimated: route.estimated,
        cost: used * pricePerUnit,
        currency: state.currency,
        people: parseInt(el.people.value, 10),
      };
      renderResults();
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

  function renderResults() {
    const t = state.lastTrip;
    const m = metric();
    const cur = t.currency;
    const cash = (n, d) => money(n, d, cur);
    const km = t.miles * KM_PER_MILE;

    el.routeLine.textContent = `${t.a.label} → ${t.b.label}${t.trips === 2 ? " (round trip)" : ""}`;
    el.totalLabel.textContent = cur === "USD" ? "Total fuel cost" : `Total fuel cost (${cur})`;
    el.totalCost.textContent = cash(t.cost);
    el.perPerson.textContent = t.people > 1 ? `${cash(t.cost / t.people)} per person (${t.people} people)` : "";
    el.rDistance.textContent = m ? `${num(km, 0)} km` : `${num(t.miles, 0)} mi`;
    el.rTime.textContent = formatDuration(t.seconds);

    if (t.isEV) {
      el.rFuel.textContent = `${num(t.used, 1)} kWh`;
      el.rMpg.textContent = m
        ? `${num(t.economy.kwhPer100mi / KM_PER_MILE, 1)} kWh/100 km`
        : `${num(t.economy.kwhPer100mi, 0)} kWh/100 mi`;
      el.rPrice.textContent = formatPrice(t.pricePerUnit, "kWh", cur);
    } else {
      el.rFuel.textContent = m ? `${num(t.used * LITRES_PER_GALLON, 1)} L` : `${num(t.used, 1)} gal`;
      el.rMpg.textContent = m
        ? `${num(MPG_TO_L100KM / t.economy.mpg, 1)} L/100 km`
        : `${num(t.economy.mpg, t.economy.mpg % 1 ? 1 : 0)} MPG`;
      el.rPrice.textContent = m
        ? formatPrice(convertPrice(t.pricePerUnit, "gal", "L"), "L", cur)
        : formatPrice(t.pricePerUnit, "gal", cur);
    }
    if (t.economy.manual) el.rMpg.textContent += " (manual)";

    const perDist = t.cost / (m ? km : t.miles);
    el.rCpmLabel.textContent = m ? "Cost per km" : "Cost per mile";
    el.rCpm.textContent = cur === "USD" || cur === "CAD" ? `${num(perDist * 100, 1)}¢` : cash(perDist, 3);

    el.routeNote.hidden = !t.estimated;
    el.routeNote.textContent = t.estimated
      ? "Driving directions were unavailable, so distance is estimated from a straight line (+25%)."
      : "";
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
    p.set("country", state.country);
    p.set("units", state.units);
    p.set("fuel", el.fuelType.value);
    p.set("price", el.price.value);
    p.set("cur", state.currency);
    if (el.people.value !== "1") p.set("people", el.people.value);
    return p;
  }

  async function restoreFromUrl() {
    const p = new URLSearchParams(location.search);
    if (!p.get("from") || !p.get("to")) return;
    state.restoring = true;
    try {
      el.from.value = p.get("from");
      el.to.value = p.get("to");
      el.roundTrip.checked = p.get("rt") === "1";
      if (p.get("people")) { el.people.value = p.get("people"); updatePeople(); }
      if (p.get("country")) setCountry(p.get("country").toUpperCase());
      if (p.get("units") === "metric" || p.get("units") === "imperial") {
        setUnits(p.get("units"));
        state.unitsChosen = true;
      }

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
      if (p.get("fuel") && FUEL_LABELS[p.get("fuel")]) el.fuelType.value = p.get("fuel");
      if (p.get("mpg")) el.manualMpg.value = p.get("mpg");
      if (parseFloat(p.get("price")) > 0) {
        if (/^[A-Z]{3}$/.test(p.get("cur") || "")) state.currency = p.get("cur");
        setPriceMode("manual");
        setPriceField(parseFloat(p.get("price")), fuelUnit());
        el.priceSource.textContent = "Price from the shared link. Edit it if needed.";
      }
      updateUnitLabels();
      await calculate();
    } finally {
      state.restoring = false;
    }
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
  el.fuelType.addEventListener("change", onFuelTypeChange);
  el.country.addEventListener("change", () => {
    setCountry(el.country.value);
    if (state.lastTrip) calculate();
  });
  el.price.addEventListener("input", () => {
    if (!state.priceEdited) setPriceMode("manual");
    el.priceSource.textContent = "Using the price you typed.";
  });
  for (const r of el.priceModeRadios) {
    r.addEventListener("change", () => {
      setPriceMode(r.value);
      if (r.value === "manual") {
        el.price.value = "";
        el.price.focus();
      }
    });
  }
  for (const r of el.unitRadios) {
    r.addEventListener("change", () => {
      state.unitsChosen = true;
      setUnits(r.value);
    });
  }
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

  // Start in the visitor's likely country (from their browser language, e.g. en-CA → Canada).
  fillCountries();
  setUnits(unitsFor(state.country));
  updateUnitLabels();

  Promise.all([loadUsPrices(), loadCityPrices(), loadYears()]).then(() => {
    applyAutoPrice();
    renderPriceCard();
    return restoreFromUrl();
  });
})();
