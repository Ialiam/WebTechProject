// Offline backup list of popular US vehicles, used only when FuelEconomy.gov
// can't be reached. Values are approximate EPA combined ratings for recent
// model years: `mpg` for fuel cars, `kwh` (kWh per 100 miles) for EVs.
window.FALLBACK_VEHICLES = {
  "BMW": { "3 Series": { mpg: 30, fuel: "premium" }, "X5": { mpg: 23, fuel: "premium" } },
  "Chevrolet": {
    "Equinox": { mpg: 28, fuel: "regular" }, "Malibu": { mpg: 29, fuel: "regular" },
    "Silverado 1500": { mpg: 20, fuel: "regular" }, "Tahoe": { mpg: 17, fuel: "regular" },
    "Bolt EV": { kwh: 28, fuel: "electric" }
  },
  "Dodge": { "Charger": { mpg: 23, fuel: "regular" }, "Durango": { mpg: 21, fuel: "regular" } },
  "Ford": {
    "Escape": { mpg: 30, fuel: "regular" }, "Explorer": { mpg: 24, fuel: "regular" },
    "F-150": { mpg: 22, fuel: "regular" }, "Mustang": { mpg: 22, fuel: "premium" },
    "Ranger": { mpg: 23, fuel: "regular" }, "Mustang Mach-E": { kwh: 33, fuel: "electric" }
  },
  "GMC": { "Sierra 1500": { mpg: 20, fuel: "regular" }, "Yukon": { mpg: 17, fuel: "regular" } },
  "Honda": {
    "Accord": { mpg: 32, fuel: "regular" }, "Civic": { mpg: 35, fuel: "regular" },
    "CR-V": { mpg: 30, fuel: "regular" }, "Odyssey": { mpg: 22, fuel: "regular" },
    "Pilot": { mpg: 22, fuel: "regular" }
  },
  "Hyundai": {
    "Elantra": { mpg: 36, fuel: "regular" }, "Santa Fe": { mpg: 25, fuel: "regular" },
    "Tucson": { mpg: 28, fuel: "regular" }, "Ioniq 5": { kwh: 30, fuel: "electric" }
  },
  "Jeep": { "Grand Cherokee": { mpg: 22, fuel: "regular" }, "Wrangler": { mpg: 20, fuel: "regular" } },
  "Kia": {
    "Forte": { mpg: 34, fuel: "regular" }, "Sorento": { mpg: 26, fuel: "regular" },
    "Sportage": { mpg: 28, fuel: "regular" }, "Telluride": { mpg: 23, fuel: "regular" }
  },
  "Mazda": { "CX-5": { mpg: 28, fuel: "regular" }, "Mazda3": { mpg: 31, fuel: "regular" } },
  "Nissan": {
    "Altima": { mpg: 32, fuel: "regular" }, "Rogue": { mpg: 33, fuel: "regular" },
    "Sentra": { mpg: 34, fuel: "regular" }
  },
  "Ram": { "1500": { mpg: 22, fuel: "regular" } },
  "Subaru": { "Forester": { mpg: 29, fuel: "regular" }, "Outback": { mpg: 29, fuel: "regular" } },
  "Tesla": {
    "Model 3": { kwh: 25, fuel: "electric" }, "Model Y": { kwh: 28, fuel: "electric" }
  },
  "Toyota": {
    "Camry": { mpg: 32, fuel: "regular" }, "Corolla": { mpg: 34, fuel: "regular" },
    "Highlander": { mpg: 24, fuel: "regular" }, "Prius": { mpg: 52, fuel: "regular" },
    "RAV4": { mpg: 30, fuel: "regular" }, "Sienna": { mpg: 36, fuel: "regular" },
    "Tacoma": { mpg: 21, fuel: "regular" }, "Tundra": { mpg: 19, fuel: "regular" }
  },
  "Volkswagen": { "Jetta": { mpg: 34, fuel: "regular" }, "Tiguan": { mpg: 26, fuel: "regular" } }
};

// Used when no live price is available. The user can always edit the price
// field to match their local pump.
// US: USD per gallon (electricity USD per kWh).
window.FALLBACK_PRICES = {
  regular: 3.15, midgrade: 3.60, premium: 3.95, diesel: 3.70, e85: 2.80, electric: 0.17
};
// Canada: rough national averages, CAD per litre (electricity CAD per kWh).
// Only used if data/prices.json can't be loaded.
window.FALLBACK_PRICES_CA = {
  regular: 1.90, midgrade: 2.10, premium: 2.20, diesel: 2.60, electric: 0.14
};
