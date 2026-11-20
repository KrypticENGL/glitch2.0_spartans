/**
 * Alert areas. Only Darbhanga district is modelled by this build (roads, shelters, flood zones), so the
 * subscribable areas are the district and its localities used in the scenario data.
 * shortcut: static list; replace with a districts/localities table (and PostGIS polygons) when more districts are added.
 */
export interface AlertArea {
  code: string;
  name: string;
  nameHi: string;
  kind: "district" | "locality";
  district: string;
}

const district = (code: string, name: string, nameHi: string): AlertArea => ({ code, name, nameHi, kind: "district", district: code });
const locality = (d: string, slug: string, name: string, nameHi: string): AlertArea => ({ code: `${d}/${slug}`, name, nameHi, kind: "locality", district: d });

export const ALERT_AREAS: AlertArea[] = [
  district("darbhanga", "Darbhanga district", "दरभंगा ज़िला"),
  locality("darbhanga", "town", "Darbhanga Town", "दरभंगा शहर"),
  locality("darbhanga", "laheriasarai", "Laheriasarai", "लहेरियासराय"),
  locality("darbhanga", "benta", "Benta", "बेंता"),
  locality("darbhanga", "kadirabad", "Kadirabad", "कादिराबाद"),
  locality("darbhanga", "donar", "Donar", "दोनार"),
  locality("darbhanga", "mabbi", "Mabbi", "मब्बी"),
  locality("darbhanga", "allalpatti", "Allalpatti", "अल्लालपट्टी"),
  locality("darbhanga", "bahadurpur", "Bahadurpur", "बहादुरपुर"),
  locality("darbhanga", "shubhankarpur", "Shubhankarpur", "शुभंकरपुर"),
];

/** Alert-only target meaning "every subscriber of this audience". */
export const ALL_AREAS = "all";
export const AREA_CODES = ALERT_AREAS.map((a) => a.code) as [string, ...string[]];
const byCode = new Map(ALERT_AREAS.map((a) => [a.code, a]));

export const isAreaCode = (code: string) => byCode.has(code);

/**
 * Subscriber areas an alert for `target` reaches: a district alert reaches the district and its localities;
 * a locality alert reaches that locality and people who chose the whole district. null = everyone.
 */
export function reachedAreas(target: string): string[] | null {
  if (target === ALL_AREAS) return null;
  const area = byCode.get(target);
  if (!area) return [];
  return area.kind === "district" ? ALERT_AREAS.filter((a) => a.district === area.code).map((a) => a.code) : [area.code, area.district];
}

export const areaLabel = (target: string, lang: "en" | "hi" = "en") =>
  target === ALL_AREAS ? (lang === "hi" ? "सभी डेमो सदस्य" : "All demo subscribers") : (lang === "hi" ? byCode.get(target)?.nameHi : byCode.get(target)?.name) ?? target;
