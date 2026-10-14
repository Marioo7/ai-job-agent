/** Canonical technology name -> aliases. Matching is case-insensitive with strict word boundaries. */
export const TECH_DICT: Record<string, string[]> = {
  javascript: ['javascript', 'ecmascript'],
  typescript: ['typescript'],
  react: ['react', 'react.js', 'reactjs', 'react js'],
  'react native': ['react native'],
  'next.js': ['next.js', 'nextjs'],
  vue: ['vue', 'vue.js', 'vuejs'],
  angular: ['angular', 'angularjs'],
  svelte: ['svelte'],
  'node.js': ['node.js', 'nodejs', 'node'],
  'express.js': ['express.js', 'expressjs'],
  nestjs: ['nestjs', 'nest.js'],
  python: ['python'],
  django: ['django'],
  flask: ['flask'],
  fastapi: ['fastapi'],
  java: ['java'],
  'spring boot': ['spring boot', 'springboot', 'spring framework'],
  kotlin: ['kotlin'],
  swift: ['swift'],
  'c#': ['c#', 'csharp'],
  '.net': ['.net', 'dotnet', 'asp.net', '.net core'],
  php: ['php'],
  laravel: ['laravel'],
  ruby: ['ruby'],
  rails: ['rails', 'ruby on rails'],
  go: ['golang'],
  rust: ['rust'],
  'c++': ['c++'],
  sql: ['sql'],
  postgresql: ['postgresql', 'postgres'],
  mysql: ['mysql'],
  mongodb: ['mongodb', 'mongo'],
  redis: ['redis'],
  firebase: ['firebase'],
  firestore: ['firestore'],
  graphql: ['graphql'],
  'rest api': ['restful', 'rest api', 'rest apis'],
  aws: ['aws', 'amazon web services'],
  azure: ['azure'],
  gcp: ['gcp', 'google cloud'],
  docker: ['docker'],
  kubernetes: ['kubernetes', 'k8s'],
  git: ['git'],
  'ci/cd': ['ci/cd', 'cicd'],
  linux: ['linux'],
  html: ['html', 'html5'],
  css: ['css', 'css3'],
  tailwind: ['tailwind', 'tailwindcss'],
  sass: ['sass', 'scss'],
  flutter: ['flutter'],
  figma: ['figma'],
  'ui/ux': ['ui/ux', 'ux/ui'],
  excel: ['ms excel', 'microsoft excel'],
  'power bi': ['power bi', 'powerbi'],
  tableau: ['tableau'],
  'machine learning': ['machine learning'],
  'deep learning': ['deep learning'],
  tensorflow: ['tensorflow'],
  pytorch: ['pytorch'],
  nlp: ['nlp'],
  'data analysis': ['data analysis', 'data analytics'],
  pandas: ['pandas'],
  numpy: ['numpy'],
  selenium: ['selenium'],
  jest: ['jest'],
  cypress: ['cypress'],
  agile: ['agile', 'scrum'],
  jira: ['jira'],
  wordpress: ['wordpress'],
  seo: ['seo'],
  odoo: ['odoo'],
  salesforce: ['salesforce'],
  devops: ['devops'],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const COMPILED: Array<{ canon: string; re: RegExp }> = [];
const ALIAS_TO_CANON = new Map<string, string>();
for (const [canon, aliases] of Object.entries(TECH_DICT)) {
  ALIAS_TO_CANON.set(canon.toLowerCase(), canon);
  for (const a of aliases) {
    ALIAS_TO_CANON.set(a.toLowerCase(), canon);
    COMPILED.push({ canon, re: new RegExp(`(?<![A-Za-z0-9+#.])${escapeRe(a)}(?![A-Za-z0-9+#])`, 'i') });
  }
}

/** Map a free-form skill name to its canonical lowercase form (unknown names are just lowercased). */
export function canonTech(name: string): string {
  const k = name.trim().toLowerCase();
  return ALIAS_TO_CANON.get(k) ?? k;
}

/** Find known technologies mentioned in a text (canonical names, deduplicated, stable order). */
export function findTechnologies(text: string): string[] {
  const found = new Set<string>();
  for (const { canon, re } of COMPILED) if (re.test(text)) found.add(canon);
  return [...found];
}
