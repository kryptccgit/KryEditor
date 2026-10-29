const RULES: ReadonlyArray<readonly [string, string, string, string]> = [
  [' ', 'are', ' ', 'AA R'],
  ['', 'air', '', 'EH R'],
  ['', 'ar', '#', 'EH R'],
  ['', 'ar', '', 'AA R'],
  ['', 'ai', '', 'EY'],
  ['', 'ay', '', 'EY'],
  ['', 'augh', '', 'AO'],
  ['', 'au', '', 'AO'],
  ['', 'aw', '', 'AO'],
  ['', 'all', '', 'AO L'],
  ['', 'alk', '', 'AO K'],
  ['', 'a', 'tion', 'EY'],
  ['w', 'a', '^', 'AA'],
  ['', 'a', '^%', 'EY'],
  ['', 'a', ' ', 'AH'],
  ['', 'a', '', 'AE'],
  ['m', 'b', ' ', ''],
  ['', 'bb', '', 'B'],
  ['', 'b', '', 'B'],
  ['', 'chr', '', 'K R'],
  ['', 'ch', '', 'CH'],
  ['', 'ck', '', 'K'],
  ['', 'cc', '+', 'K S'],
  ['', 'cc', '', 'K'],
  ['', 'cious', '', 'SH AH S'],
  ['', 'cial', '', 'SH AH L'],
  ['', 'cian', '', 'SH AH N'],
  ['', 'c', '+', 'S'],
  ['', 'c', '', 'K'],
  ['', 'dge', '', 'JH'],
  ['', 'dd', '', 'D'],
  ['', 'd', '', 'D'],
  ['#:', 'e', ' ', ''],
  ['#:', 'es', ' ', 'Z'],
  ['', 'eau', '', 'OW'],
  ['', 'ee', '', 'IY'],
  ['', 'ea', '', 'IY'],
  ['', 'ey', ' ', 'IY'],
  ['', 'ei', '', 'EY'],
  ['', 'ey', '', 'EY'],
  ['', 'ew', '', 'UW'],
  ['', 'eu', '', 'UW'],
  ['', 'er', '#', 'EH R'],
  ['', 'er', '', 'ER'],
  ['', 'e', ' ', 'IY'],
  ['', 'e', '^%', 'IY'],
  ['', 'e', '', 'EH'],
  ['', 'ff', '', 'F'],
  ['', 'f', '', 'F'],
  [' ', 'gh', '', 'G'],
  ['', 'gh', '', ''],
  [' ', 'gn', '', 'N'],
  ['', 'gn', ' ', 'N'],
  ['', 'gg', '', 'G'],
  ['', 'g', '+', 'JH'],
  ['', 'g', '', 'G'],
  ['#', 'h', ' ', ''],
  ['', 'h', '', 'HH'],
  ['', 'igh', '', 'AY'],
  ['', 'ie', ' ', 'IY'],
  ['', 'ie', '', 'IY'],
  ['', 'ir', '', 'ER'],
  ['', 'ing', ' ', 'IH NG'],
  ['', 'ind', ' ', 'AY N D'],
  ['', 'ild', ' ', 'AY L D'],
  ['', 'i', '^%', 'AY'],
  ['', 'i', '#', 'IY'],
  ['', 'i', '', 'IH'],
  ['', 'j', '', 'JH'],
  [' ', 'kn', '', 'N'],
  ['', 'k', '', 'K'],
  ['', 'll', '', 'L'],
  ['', 'l', '', 'L'],
  ['', 'mm', '', 'M'],
  ['', 'm', '', 'M'],
  ['', 'nn', '', 'N'],
  ['', 'ng', '#', 'NG G'],
  ['', 'ng', '', 'NG'],
  ['', 'nk', '', 'NG K'],
  ['', 'n', '', 'N'],
  ['', 'ook', '', 'UH K'],
  ['', 'oo', '', 'UW'],
  ['', 'ought', '', 'AO T'],
  ['', 'ough', '', 'OW'],
  ['', 'ous', ' ', 'AH S'],
  ['', 'ould', '', 'UH D'],
  ['', 'ou', '', 'AW'],
  ['', 'ow', ' ', 'OW'],
  ['', 'ow', '', 'AW'],
  ['', 'oi', '', 'OY'],
  ['', 'oy', '', 'OY'],
  ['', 'oa', '', 'OW'],
  ['', 'oe', ' ', 'OW'],
  ['', 'or', '', 'AO R'],
  ['', 'o', '^%', 'OW'],
  ['', 'o', ' ', 'OW'],
  ['', 'o', 'ld', 'OW'],
  ['', 'o', '', 'AA'],
  ['', 'ph', '', 'F'],
  [' ', 'ps', '', 'S'],
  ['', 'pp', '', 'P'],
  ['', 'p', '', 'P'],
  ['', 'qu', '', 'K W'],
  ['', 'q', '', 'K'],
  ['', 'rr', '', 'R'],
  ['', 'rh', '', 'R'],
  ['', 'r', '', 'R'],
  ['', 'sch', '', 'S K'],
  ['', 'sh', '', 'SH'],
  ['', 'ssion', '', 'SH AH N'],
  ['#', 'sion', '', 'ZH AH N'],
  ['', 'sion', '', 'SH AH N'],
  ['', 'sure', '', 'SH ER'],
  ['', 'ss', '', 'S'],
  ['.', 's', ' ', 'Z'],
  ['#', 's', '#', 'Z'],
  ['', 's', '', 'S'],
  ['', 'tion', '', 'SH AH N'],
  ['', 'tial', '', 'SH AH L'],
  ['', 'ture', '', 'CH ER'],
  ['', 'tch', '', 'CH'],
  ['', 'th', '', 'TH'],
  ['', 'tt', '', 'T'],
  ['', 't', '', 'T'],
  ['', 'ue', ' ', 'UW'],
  ['', 'ui', '', 'UW'],
  ['', 'ur', '#', 'UH R'],
  ['', 'ur', '', 'ER'],
  [' ', 'u', 'n', 'AH'],
  ['', 'u', '^%', 'UW'],
  ['', 'u', ' ', 'UW'],
  ['', 'u', '', 'AH'],
  ['', 'v', '', 'V'],
  [' ', 'wr', '', 'R'],
  ['', 'wh', '', 'W'],
  ['', 'war', '', 'W AO R'],
  ['', 'wor', '', 'W ER'],
  ['', 'w', '', 'W'],
  [' ', 'x', '', 'Z'],
  ['', 'x', '', 'K S'],
  [' ', 'y', '#', 'Y'],
  ['#:', 'y', ' ', 'IY'],
  ['', 'y', ' ', 'AY'],
  ['', 'y', '^%', 'AY'],
  ['', 'y', '#', 'Y'],
  ['', 'y', '', 'IH'],
  ['', 'zz', '', 'Z'],
  ['', 'z', '', 'Z'],
];

const isVowel = (c: string): boolean => 'aeiouy'.includes(c) && c !== '';
const isConsonant = (c: string): boolean => c >= 'a' && c <= 'z' && !isVowel(c);
const isVoiced = (c: string): boolean => c !== '' && 'bdgjlmnrvwz'.includes(c);
const isFront = (c: string): boolean => c === 'e' || c === 'i' || c === 'y';

const SUFFIXES = ['ers', 'ely', 'ing', 'es', 'ed', 'er', 'en', 'e', 'y'];

function matchRight(pat: string, w: string, pos: number): boolean {
  const at = (p: number): string => w[p] ?? ' ';
  for (const s of pat) {
    const c = at(pos);
    switch (s) {
      case '#':
        if (!isVowel(c)) return false;
        while (pos < w.length && isVowel(w[pos])) pos++;
        break;
      case ':':
        while (pos < w.length && isConsonant(w[pos])) pos++;
        break;
      case '^':
        if (!isConsonant(c)) return false;
        pos++;
        break;
      case '.':
        if (!isVoiced(c)) return false;
        pos++;
        break;
      case '+':
        if (!isFront(c)) return false;
        pos++;
        break;
      case '%': {
        const rest = w.slice(Math.min(pos, w.length));
        return SUFFIXES.some((x) => rest.startsWith(x) && (rest[x.length] ?? ' ') === ' ');
      }
      default:
        if (c !== s) return false;
        pos++;
    }
  }
  return true;
}

function matchLeft(pat: string, w: string, pos: number): boolean {
  let p = pos - 1;
  const at = (i: number): string => (i >= 0 ? (w[i] ?? ' ') : ' ');
  for (const s of [...pat].reverse()) {
    const c = at(p);
    switch (s) {
      case '#':
        if (!isVowel(c)) return false;
        while (p >= 0 && isVowel(at(p))) p--;
        break;
      case ':':
        while (p >= 0 && isConsonant(at(p))) p--;
        break;
      case '^':
        if (!isConsonant(c)) return false;
        p--;
        break;
      case '.':
        if (!isVoiced(c)) return false;
        p--;
        break;
      case '+':
        if (!isFront(c)) return false;
        p--;
        break;
      default:
        if (c !== s) return false;
        p--;
    }
  }
  return true;
}

const VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];

export function isVowelPhone(p: string): boolean {
  return VOWELS.includes(p.replace(/[0-9]+$/, ''));
}

const UNSTRESSED_PREFIXES = ['be', 'de', 're', 'con', 'com', 'ex', 'pre', 'pro', 'per', 'a'];

export function wordToArpabet(word: string): string[] {
  const w = [...word].filter((c) => c >= 'a' && c <= 'z').join('');
  const phones: string[] = [];
  let pos = 0;
  while (pos < w.length) {
    const rule = RULES.find(([left, g, right]) => w.startsWith(g, pos) && matchLeft(left, w, pos) && matchRight(right, w, pos + g.length));
    if (rule) {
      phones.push(...rule[3].split(' ').filter(Boolean));
      pos += rule[1].length;
    } else pos++;
  }
  const deduped = phones.filter((p, i) => i === 0 || p !== phones[i - 1] || isVowelPhone(p));
  assignStress(word, deduped);
  return deduped;
}

function assignStress(word: string, phones: string[]): void {
  const vowels = phones.map((p, i) => (isVowelPhone(p) ? i : -1)).filter((i) => i >= 0);
  const n = vowels.length;
  if (n === 0) return;
  let primary = 0;
  if (n === 1) primary = 0;
  else if (['tion', 'sion', 'cian', 'cial', 'tial', 'cious', 'ic', 'ics'].some((s) => word.endsWith(s))) primary = n - 2;
  else if (word.endsWith('ity') && n >= 3) primary = n - 3;
  else if (UNSTRESSED_PREFIXES.some((p) => word.startsWith(p) && word.length > p.length + 2)) primary = 1;
  vowels.forEach((i, k) => {
    const base = phones[i];
    if (k === primary) phones[i] = `${base}1`;
    else if (['AA', 'AE', 'AH', 'EH'].includes(base) && k + 1 !== n) phones[i] = 'AH0';
    else phones[i] = `${base}0`;
  });
}
