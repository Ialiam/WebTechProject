// Site settings. See README.md → "Live fuel prices near the user".
window.TRIPFUEL_CONFIG = {
  // Google Maps Platform API key with "Places API (New)" enabled. When set, the
  // site fills in today's pump prices from gas stations near the starting
  // point. Leave empty to use national averages instead.
  // Restrict the key to your website's address in Google Cloud Console, since
  // anyone can read it in the page source.
  googleMapsApiKey: "",

  // How far from the starting point to look for gas stations, in metres.
  stationSearchRadius: 8000,
};
