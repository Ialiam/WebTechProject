# TripFuelCost – Trip Fuel Cost Calculator

A free website that tells people how much a drive will cost in fuel.

1. The user types a **From** and **To** location. Suggestions appear as they type.
2. They pick their car's **year, make and model**, plus the engine/trim if there's more than one.
3. The site loads **today's fuel price** for that car's fuel type and shows the **total trip cost**: distance, gallons used, cost per mile and a route map. It also handles round trips and splitting the cost between passengers.

The site is plain HTML, CSS and JavaScript. It needs no build step, server or API keys, so it can be hosted free on GitHub Pages, Netlify or Cloudflare Pages.

## Data sources (all free, no key required)

| What | Service |
|------|---------|
| Car year/make/model and EPA MPG | [FuelEconomy.gov web services](https://www.fueleconomy.gov/feg/ws/) |
| Today's fuel prices (national average) | FuelEconomy.gov `/ws/rest/fuelprices` (EIA data, updated weekly) |
| Location autocomplete | [Photon](https://photon.komoot.io) (OpenStreetMap) |
| Driving distance and time | [OSRM](https://project-osrm.org) demo server |
| Map | [Leaflet](https://leafletjs.com) + OpenStreetMap tiles |

If one of these services is down, the site keeps working:
- If the vehicle lookup fails, it uses a built-in list of popular cars (`vehicles-fallback.js`), and the user can always type their MPG manually.
- If the fuel price feed fails, it shows typical average prices, and the user can always edit the price.
- If routing fails, it estimates the distance from the straight-line distance plus 25%.

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

The OSRM demo server and the public Photon instance are free, shared services with fair-use limits. Once the site gets thousands of daily visitors, switch the URLs at the top of `app.js` (`GEOCODE_API`, `ROUTE_API`) to a paid or self-hosted provider, such as OpenRouteService, Mapbox or Google Maps.
