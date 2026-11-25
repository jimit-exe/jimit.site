// Single source of truth for personal details and links.
export const site = {
  name: 'Jimit Patel',
  role: 'Offensive Security & AI Red Teaming',
  location: 'Sydney, Australia',
  url: 'https://jimit.site',
  email: 'jimitpatel932@gmail.com',
  resume: '/resume.pdf',
  links: {
    github: 'https://github.com/jimit-exe',
    linkedin: 'https://linkedin.com/in/patel-jimit',
  },
  pitch:
    'Postgraduate cybersecurity student at UTS with a full-stack engineering background, now focused on breaking systems rather than building them. I pair hands-on offensive practice — a self-built attack/detection lab, custom Python tooling, and AI red teaming research — with a methodical, evidence-driven approach to vulnerability discovery and reporting.',
} as const;

/** The page's clean path. With build.format 'file', production builds report /writeups.html. */
export const cleanPath = (pathname: string) =>
  pathname.replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1') || '/';
