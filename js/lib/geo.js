// Canada-only address helpers for register.html and the settings page's
// address editor: a fixed province list, a curated (not exhaustive) list
// of cities per province so the common case is a dropdown rather than
// free text, and Canadian postal code formatting/validation.
//
// A city typed that isn't in the list still works — the city field falls
// back to free text rather than blocking registration over a list that
// can never cover every town.

export const PROVINCES = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' }
];

export const PROVINCE_NAME = Object.fromEntries(PROVINCES.map((p) => [p.code, p.name]));

// Major cities only — enough that most people find theirs in the
// dropdown. Anything else uses the "Other" option's free-text field.
export const CITIES_BY_PROVINCE = {
  AB: ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge', 'St. Albert', 'Medicine Hat',
    'Grande Prairie', 'Airdrie', 'Spruce Grove', 'Leduc', 'Fort Saskatchewan', 'Okotoks'],
  BC: ['Vancouver', 'Surrey', 'Burnaby', 'Richmond', 'Abbotsford', 'Coquitlam', 'Kelowna',
    'Victoria', 'Langley', 'Saanich', 'Delta', 'Nanaimo', 'Kamloops', 'Chilliwack',
    'Maple Ridge', 'North Vancouver', 'New Westminster', 'Port Coquitlam', 'Vernon', 'Prince George'],
  MB: ['Winnipeg', 'Brandon', 'Steinbach', 'Thompson', 'Portage la Prairie'],
  NB: ['Saint John', 'Moncton', 'Fredericton', 'Dieppe', 'Miramichi'],
  NL: ["St. John's", 'Mount Pearl', 'Corner Brook', 'Conception Bay South'],
  NS: ['Halifax', 'Dartmouth', 'Sydney', 'Truro', 'New Glasgow'],
  NT: ['Yellowknife', 'Hay River', 'Inuvik'],
  NU: ['Iqaluit', 'Rankin Inlet', 'Arviat'],
  ON: ['Toronto', 'Etobicoke', 'Scarborough', 'North York', 'Mississauga', 'Brampton',
    'Hamilton', 'London', 'Markham', 'Vaughan', 'Kitchener', 'Windsor', 'Richmond Hill',
    'Oakville', 'Burlington', 'Oshawa', 'Barrie', 'St. Catharines', 'Guelph', 'Cambridge',
    'Whitby', 'Ajax', 'Thunder Bay', 'Waterloo', 'Milton', 'Pickering', 'Niagara Falls',
    'Sudbury', 'Kingston', 'Sarnia'],
  PE: ['Charlottetown', 'Summerside', 'Stratford', 'Cornwall'],
  QC: ['Montreal', 'Quebec City', 'Laval', 'Gatineau', 'Longueuil', 'Sherbrooke', 'Saguenay',
    'Levis', 'Trois-Rivieres', 'Terrebonne', 'Saint-Jean-sur-Richelieu', 'Repentigny',
    'Brossard', 'Drummondville', 'Saint-Jerome'],
  SK: ['Saskatoon', 'Regina', 'Prince Albert', 'Moose Jaw', 'Swift Current', 'Yorkton'],
  YT: ['Whitehorse', 'Dawson City', 'Watson Lake']
};

export const OTHER_CITY = '__other__';

// A1A 1A1 — uppercase, one space after the third character. Formats as
// the person types rather than only validating after the fact.
export function formatPostalCode(raw) {
  const clean = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return clean.length > 3 ? `${clean.slice(0, 3)} ${clean.slice(3)}` : clean;
}

const POSTAL_RE = /^[A-Z]\d[A-Z] \d[A-Z]\d$/;

export function isValidPostalCode(formatted) {
  return POSTAL_RE.test(formatted);
}

// One line for display and for the duplicate-house check.
export function formatAddress({ addressLine, city, province, postalCode }) {
  const parts = [addressLine, city, province ? PROVINCE_NAME[province] ?? province : null, postalCode]
    .filter(Boolean);
  return parts.join(', ');
}

// Shared markup for register.html and the settings page's address
// editor, so the province list and the "known city, or Other" logic
// exist in exactly one place.

export function provinceOptionsHTML(selected = '') {
  return `<option value="" disabled${selected ? '' : ' selected'}>Choose a province</option>`
    + PROVINCES.map((p) =>
      `<option value="${p.code}"${p.code === selected ? ' selected' : ''}>${p.name}</option>`
    ).join('');
}

export function cityOptionsHTML(provinceCode, selectedCity = '') {
  const cities = CITIES_BY_PROVINCE[provinceCode] ?? [];
  const known = cities.includes(selectedCity);
  return `<option value="" disabled${selectedCity ? '' : ' selected'}>Choose a city</option>`
    + cities.map((c) =>
      `<option value="${c}"${c === selectedCity ? ' selected' : ''}>${c}</option>`
    ).join('')
    + `<option value="${OTHER_CITY}"${selectedCity && !known ? ' selected' : ''}>Other&hellip;</option>`;
}

// Re-populates a <select> of cities for a newly chosen province, keeping
// selectedCity if it's one of that province's listed cities.
export function syncCityOptions(citySelect, provinceCode, selectedCity = '') {
  citySelect.disabled = !provinceCode;
  citySelect.innerHTML = provinceCode
    ? cityOptionsHTML(provinceCode, selectedCity)
    : '<option value="" disabled selected>Choose a province first</option>';
}
