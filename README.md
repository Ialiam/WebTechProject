# TripFuelCost – Trip Fuel Cost Calculator

A free website that tells people how much a drive will cost in fuel.

1. The user types a **From** and **To** location. Suggestions appear as they type.
2. They pick their car's **year, make and model**, plus the engine/trim if there's more than one.
3. The site fills in **today's fuel price** for that car's fuel type and shows the **total trip cost**: distance, fuel used, cost per mile or km, and a route map. It also handles round trips and splitting the cost between passengers.

The first field is **Country**. The rest of the form follows it:
- **United States:** miles, gallons, MPG and US dollars.
- **Canada:** kilometres, litres, L/100 km and Canadian dollars.
- **Other countries:** kilometres, litres and the local currency.

The country starts from the visitor's browser language (for example `en-CA` → Canada), and it follows the starting point if someone picks a city in another country. Location suggestions show places in the chosen country first. Visitors can still switch units with the **Units** buttons.

The site is plain HTML, CSS and JavaScript. It needs no build step, server or API keys, so it can be hosted free on GitHub Pages, Netlify or Cloudflare Pages.

## Data sources (all free, no key required)

| What | Service |
|------|---------|
| Car year/make/model and EPA MPG | [FuelEconomy.gov web services](https://www.fueleconomy.gov/feg/ws/) |
| Daily average pump prices for 69 Canadian cities (Sudbury, Toronto, Vancouver…) | [Natural Resources Canada](https://www2.nrcan.gc.ca/eneene/sources/pripri/prices_bycity_e.cfm), collected into `data/prices.json` every day (see below) |
| Today's pump prices at stations near the starting point | [Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service/nearby-search), optional, needs your API key |
| US national average fuel prices | FuelEconomy.gov `/ws/rest/fuelprices` (EIA data, updated weekly) |
| Location autocomplete | [Photon](https://photon.komoot.io) (OpenStreetMap) |
| Driving distance and time | [Valhalla](https://github.com/valhalla/valhalla) on the FOSSGIS server (the one openstreetmap.org uses); backup: [OSRM](https://project-osrm.org) demo server |
| Map | [Leaflet](https://leafletjs.com) + OpenStreetMap tiles |

If one of these services is down, the site keeps working:
- If the vehicle lookup fails, it uses a built-in list of popular cars (`vehicles-fallback.js`), and the user can always type their MPG manually.
- Price order: stations near the starting point (with a Google key), then the nearest Canadian city's daily average (within 100 km), then the national average. In other countries it asks for the price.
- Visitors choose between **Find today's price** and **Type the pump price**. Once they type a price, it stays even if they change the city or fuel type.
- If routing fails, it estimates the distance from the straight-line distance plus 25%.

## Daily Canadian city prices (free)

`.github/workflows/update-prices.yml` runs `scripts/update_prices.py` twice a day on GitHub's servers. The script reads Natural Resources Canada's daily average prices (regular, midgrade, premium, diesel) for about 70 cities plus the national average, and saves them to `data/prices.json`. If anything looks wrong (too few cities, or impossible prices), it keeps the previous file.

- It's free: no key, no card, and it only uses GitHub Actions minutes, which are free for public repos.
- To run it right away, go to **Actions → Update fuel prices → Run workflow**.
- GitHub pauses scheduled workflows in repos with no activity for 60 days. The daily price commits count as activity, but if it ever pauses, click **Enable workflow** on that page.

## Live fuel prices near the user (optional, Google)

With a Google Maps API key, the site looks up gas stations within 8 km of the starting point, takes their posted prices for the car's fuel type, and fills in the typical (median) price. It also lists nearby stations with the cheapest first. Google shows station prices for Canada, the US and many other countries.

1. Go to [Google Cloud Console](https://console.cloud.google.com/). Create a project and turn on billing.
2. Under **APIs & Services → Library**, enable **Places API (New)**.
3. Under **APIs & Services → Credentials**, click **Create credentials → API key**.
4. Restrict the key, because it is visible in the page source:
   - **Application restrictions** → **Websites**: add `https://ialiam.github.io/*` (and your own domain if you have one).
   - **API restrictions** → **Places API (New)** only.
5. Paste the key into `config.js` as `googleMapsApiKey`.
6. Recommended: set a monthly **budget alert** under **Billing → Budgets & alerts**.

**Cost:** station prices come from the Places Nearby Search "Enterprise" tier. Google includes a free monthly allowance per tier, and after that you pay per lookup. Check [Google's current pricing](https://mapsplatform.google.com/pricing/) before launching. The site makes at most one lookup per starting point and caches it in the visitor's browser for 30 minutes.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy for free (GitHub Pages)

1. Merge this branch into `master`.
2. In the GitHub repo, go to **Settings → Pages**. Set the source to **Deploy from a branch**, with branch `master` and folder `/ (root)`.
3. The site goes live at `https://<your-username>.github.io/WebTechProject/`.
4. Optional: buy a domain (for example `tripfuelcost.com`) and add it under **Custom domain**. A real domain helps a lot with ad approval and SEO.

## Making money from it

- **Google AdSense**: the page has three placeholder ad slots (`<div class="ad-slot">`). Once AdSense approves your site, paste its script into `<head>` in `index.html` and swap each placeholder for an `<ins class="adsbygoogle">` unit. A privacy policy that mentions ad cookies is already included (`privacy.html`), which AdSense requires.
- **Affiliate links**: you could add links under the results, such as gas rewards cards, roadside assistance, car rentals or hotels along the route.
- **Traffic (SEO)**: the page already has a title, description and Open Graph tags. Each calculation also gets a shareable URL (for example `?from=Dallas&to=Houston&year=2020&make=Toyota&model=Camry`). You could publish pages for popular routes such as "Cost to drive from LA to Las Vegas" and link them to pre-filled calculations.

### Before you get heavy traffic

The Valhalla (FOSSGIS) and OSRM demo servers and the public Photon instance are free, shared services with fair-use limits. Once the site gets thousands of daily visitors, switch the URLs at the top of `app.js` (`GEOCODE_API`, `ROUTE_API`, `BACKUP_ROUTE_API`) to a paid or self-hosted provider, such as Stadia Maps (hosted Valhalla), OpenRouteService, Mapbox or Google Maps.
