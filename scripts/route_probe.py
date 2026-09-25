# Temporary: compare drive times from free routing services.
import json, urllib.request, urllib.parse

UA = {"User-Agent": "TripFuelCost route check (GitHub Actions)", "Origin": "https://ialiam.github.io"}

def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **({"Content-Type": "application/json"} if data else {})})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r), r.headers.get("access-control-allow-origin")

def geocode(q):
    d, _ = get("https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": q, "limit": 1}))
    f = d["features"][0]
    p = f["properties"]
    return f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0], ", ".join(str(p.get(k)) for k in ("housenumber", "street", "name", "city") if p.get(k))

def osrm(base, a, b):
    d, cors = get(f"{base}/{a[1]},{a[0]};{b[1]},{b[0]}?overview=false")
    r = d["routes"][0]
    return r["distance"] / 1000, r["duration"] / 60, cors

def valhalla(a, b):
    body = {"locations": [{"lat": a[0], "lon": a[1]}, {"lat": b[0], "lon": b[1]}], "costing": "auto", "units": "kilometers"}
    d, cors = get("https://valhalla1.openstreetmap.de/route", json.dumps(body).encode())
    s = d["trip"]["summary"]
    return s["length"], s["time"] / 60, cors

trips = [
    ("256 Caswell Drive, Sudbury, Ontario", "25 Beidesburg, Toronto", None),
    ("Sudbury, Ontario", "Toronto, Ontario", "about 3 h 45 min"),
    ("Toronto, Ontario", "Montreal, Quebec", "about 5 h 20 min"),
    ("Dallas, Texas", "Houston, Texas", "about 3 h 35 min"),
    ("Los Angeles, California", "Las Vegas, Nevada", "about 4 h"),
    ("Calgary, Alberta", "Edmonton, Alberta", "about 3 h"),
]
for fa, fb, google in trips:
    try:
        a, b = geocode(fa), geocode(fb)
    except Exception as e:
        print("GEOCODE FAIL", fa, fb, e); continue
    print(f"\n{fa} -> {fb}   (Google, from memory: {google})\n  from: {a}\n  to:   {b}")
    for name, fn in [
        ("OSRM demo", lambda: osrm("https://router.project-osrm.org/route/v1/driving", a, b)),
        ("OSRM FOSSGIS", lambda: osrm("https://routing.openstreetmap.de/routed-car/route/v1/driving", a, b)),
        ("Valhalla FOSSGIS", lambda: valhalla(a, b)),
    ]:
        try:
            km, mins, cors = fn()
            print(f"  {name:17} {km:6.0f} km  {int(mins // 60)} h {int(mins % 60):02d} min   avg {km / (mins / 60):5.1f} km/h   CORS={cors}")
        except Exception as e:
            print(f"  {name:17} FAILED {e}")
