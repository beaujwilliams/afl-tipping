import test from "node:test";
import assert from "node:assert/strict";
import { formatVenueWithCity, normalizeVenue } from "../../lib/venue-display.ts";

test("formatVenueWithCity adds the city for normalized AFL venues", () => {
  assert.equal(formatVenueWithCity("GMHBA Stadium"), "GMHBA Stadium (Geelong)");
  assert.equal(formatVenueWithCity("Kardinia Park"), "GMHBA Stadium (Geelong)");
  assert.equal(formatVenueWithCity("S.C.G."), "SCG (Sydney)");
});

test("formatVenueWithCity leaves unknown or missing venues readable", () => {
  assert.equal(formatVenueWithCity("Springfield Oval"), "Springfield Oval");
  assert.equal(formatVenueWithCity(null), "TBC");
});

test("normalizeVenue keeps existing stadium aliases stable", () => {
  assert.equal(normalizeVenue("Brisbane Cricket Ground"), "The Gabba");
  assert.equal(normalizeVenue("Metricon Stadium"), "Heritage Bank Stadium");
});
