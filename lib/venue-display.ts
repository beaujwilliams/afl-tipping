const VENUE_MAP: Record<string, string> = {
  "Sydney Showground": "ENGIE Stadium",
  "Sydney Showground Stadium": "ENGIE Stadium",
  "S.C.G.": "SCG",
  SCG: "SCG",
  Docklands: "Marvel Stadium",
  "Etihad Stadium": "Marvel Stadium",
  "Marvel Stadium": "Marvel Stadium",
  "M.C.G.": "MCG",
  MCG: "MCG",
  "Kardinia Park": "GMHBA Stadium",
  "G.M.H.B.A. Stadium": "GMHBA Stadium",
  "GMHBA Stadium": "GMHBA Stadium",
  "Adelaide Oval": "Adelaide Oval",
  "Norwood Oval": "Norwood Oval",
  "Perth Stadium": "Optus Stadium",
  "Optus Stadium": "Optus Stadium",
  "Brisbane Cricket Ground": "The Gabba",
  Gabba: "The Gabba",
  Carrara: "Heritage Bank Stadium",
  "Metricon Stadium": "Heritage Bank Stadium",
  "Heritage Bank Stadium": "Heritage Bank Stadium",
  "Bellerive Oval": "Blundstone Arena",
  "Blundstone Arena": "Blundstone Arena",
  "York Park": "UTAS Stadium",
  "UTAS Stadium": "UTAS Stadium",
  "Manuka Oval": "Manuka Oval",
  "TIO Stadium": "TIO Stadium",
  "Cazaly's Stadium": "Cazaly's Stadium",
  "Cazalys Stadium": "Cazaly's Stadium",
};

const VENUE_CITY_MAP: Record<string, string> = {
  "ENGIE Stadium": "Sydney Olympic Park",
  SCG: "Sydney",
  "Marvel Stadium": "Melbourne",
  MCG: "Melbourne",
  "GMHBA Stadium": "Geelong",
  "Adelaide Oval": "Adelaide",
  "Norwood Oval": "Adelaide",
  "Optus Stadium": "Perth",
  "The Gabba": "Brisbane",
  "Heritage Bank Stadium": "Gold Coast",
  "Blundstone Arena": "Hobart",
  "UTAS Stadium": "Launceston",
  "Manuka Oval": "Canberra",
  "TIO Stadium": "Darwin",
  "Cazaly's Stadium": "Cairns",
};

export function normalizeVenue(venue: string | null) {
  if (!venue) return "TBC";
  const key = venue.trim();
  return VENUE_MAP[key] ?? key;
}

export function formatVenueWithCity(venue: string | null) {
  const normalizedVenue = normalizeVenue(venue);
  const city = VENUE_CITY_MAP[normalizedVenue];

  if (!city || normalizedVenue === "TBC") {
    return normalizedVenue;
  }

  return `${normalizedVenue} (${city})`;
}
