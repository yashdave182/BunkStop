export const GROUPS = [
  { label: 'TY CE-1', value: 'TY CE-1' },
  { label: 'TY CE-2', value: 'TY CE-2' },
  { label: 'TY CE-3', value: 'TY CE-3' },
];

export const SUBJECT_TOTALS: Record<string, Record<string, number>> = {
  'TY CE-1': {
    'Analysis & Design of Algorithm (ADA)': 22,
    'Computer Network (CN)': 21,
    'Software Engineering (SE)': 16,
    'Elective (PDS/CS)': 11,
    'Professional Ethics (PEM)': 16,
    'Contributor Personality Dev Pr (CPDP)': 16,
    'Design Engineering (DE)': 0,
  },
  'TY CE-2': {
    'Analysis & Design of Algorithm (ADA)': 22,
    'Computer Network (CN)': 22,
    'Software Engineering (SE)': 15,
    'Elective (PDS/CS)': 11,
    'Professional Ethics (PEM)': 16,
    'Contributor Personality Dev Pr (CPDP)': 10,
    'Design Engineering (DE)': 0,
  },
  'TY CE-3': {
    'Analysis & Design of Algorithm (ADA)': 21,
    'Computer Network (CN)': 22,
    'Software Engineering (SE)': 16,
    'Elective (PDS/CS)': 11,
    'Professional Ethics (PEM)': 12,
    'Contributor Personality Dev Pr (CPDP)': 10,
    'Design Engineering (DE)': 0,
  },
};

export const SUBJECT_CODE_MAP: Record<string, string> = {
  'CN': 'Computer Network (CN)',
  'ADA': 'Analysis & Design of Algorithm (ADA)',
  'SE': 'Software Engineering (SE)',
  'PE': 'Professional Ethics (PEM)',
  'CPDP': 'Contributor Personality Dev Pr (CPDP)',
  'CS/PYTHON': 'Elective (PDS/CS)',
};
