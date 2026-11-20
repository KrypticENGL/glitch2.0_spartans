export interface SOSForm {
  area: string;
  type: string;
  people: string;
  medical: boolean;
  notes: string;
  contact: string;
}

export type Errors<T> = Partial<Record<keyof T, string>>;

export function validateSOS(f: SOSForm): Errors<SOSForm> {
  const e: Errors<SOSForm> = {};
  if (!f.area) e.area = "Choose where help is needed.";
  if (!f.type) e.type = "Choose the kind of emergency.";
  const n = Number(f.people);
  if (!f.people.trim() || !Number.isInteger(n) || n < 1 || n > 500) e.people = "Enter a whole number of people between 1 and 500.";
  if (f.notes.length > 500) e.notes = "Keep notes under 500 characters.";
  const digits = f.contact.replace(/[\s-]/g, "").replace(/^\+?91/, "");
  if (f.contact.trim() && !/^\d{10}$/.test(digits)) e.contact = "Enter a 10-digit mobile number, or leave this empty.";
  return e;
}

export interface HazardForm {
  area: string;
  type: string;
  severity: string;
  description: string;
}

export function validateHazard(f: HazardForm): Errors<HazardForm> {
  const e: Errors<HazardForm> = {};
  if (!f.area) e.area = "Choose where the hazard is.";
  if (!f.type) e.type = "Choose the type of hazard.";
  if (!f.severity) e.severity = "Choose how severe it is.";
  if (f.description.trim().length < 10) e.description = "Describe the hazard in at least 10 characters.";
  if (f.description.length > 500) e.description = "Keep the description under 500 characters.";
  return e;
}
