import { wordToArpabet } from './lts';
import { cardinal, parseUint, spellToken } from './numbers';

let dictText = '';
let dictLines: Uint32Array | null = null;

export function loadDict(text: string): void {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0 && i + 1 < text.length; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  dictText = text;
  dictLines = Uint32Array.from(starts);
}

export function dictLoaded(): boolean {
  return dictLines !== null;
}

function dictLine(i: number): string {
  const start = dictLines![i];
  const end = dictText.indexOf('\n', start);
  return dictText.slice(start, end < 0 ? dictText.length : end);
}

export function cmu(word: string): string | null {
  if (!dictLines) return null;
  let lo = 0;
  let hi = dictLines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const line = dictLine(mid);
    const sp = line.indexOf(' ');
    const key = sp < 0 ? line : line.slice(0, sp);
    if (key < word) lo = mid + 1;
    else if (key > word) hi = mid;
    else return sp < 0 ? null : line.slice(sp + 1);
  }
  return null;
}

function vowelSymbol(base: string, stress: number): string | null {
  switch (base) {
    case 'AA': return 'ɑ';
    case 'AE': return 'æ';
    case 'AH': return stress === 0 ? 'ə' : 'ʌ';
    case 'AO': return 'ɔ';
    case 'AW': return 'W';
    case 'AY': return 'I';
    case 'EH': return 'ɛ';
    case 'ER': return stress === 0 ? 'əɹ' : 'ɜɹ';
    case 'EY': return 'A';
    case 'IH': return 'ɪ';
    case 'IY': return 'i';
    case 'OW': return 'O';
    case 'OY': return 'Y';
    case 'UH': return 'ʊ';
    case 'UW': return 'u';
    default: return null;
  }
}

const CONSONANTS: Record<string, string> = {
  B: 'b', CH: 'ʧ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'ʤ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ',
  P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

function splitStress(p: string): [string, number | null] {
  const last = p[p.length - 1];
  return last === '0' || last === '1' || last === '2' ? [p.slice(0, -1), +last] : [p, null];
}

export function arpabetToKokoro(phones: string[]): string {
  const ph = phones.map(splitStress);
  const isV = (i: number): boolean => ph[i] !== undefined && ph[i][1] !== null;
  let out = '';
  ph.forEach(([base, stress], i) => {
    if (stress !== null) {
      if (stress === 1) out += 'ˈ';
      else if (stress === 2) out += 'ˌ';
      out += vowelSymbol(base, stress) ?? '';
      return;
    }
    if (base === 'T' && i > 0) {
      const afterVowel = isV(i - 1) || (ph[i - 1][0] === 'R' && i >= 2 && isV(i - 2));
      const nextUnstressed = ph[i + 1]?.[1] === 0;
      const tnEnding = ph[i + 1]?.[0] === 'AH' && ph[i + 2]?.[0] === 'N' && i + 3 === ph.length;
      if (afterVowel && nextUnstressed && !tnEnding) {
        out += 'ɾ';
        return;
      }
    }
    out += CONSONANTS[base] ?? '';
  });
  return out;
}

const FUNCTION_WORDS: Record<string, string> = {
  a: 'ə', an: 'ən', the: 'ðə', to: 'tə', of: 'əv', and: 'ænd', or: 'ɔɹ', but: 'bʌt', for: 'fɔɹ', from: 'fɹʌm',
  at: 'æt', in: 'ɪn', on: 'ɑn', as: 'æz', is: 'ɪz', are: 'ɑɹ', was: 'wʌz', were: 'wɜɹ', be: 'bi', been: 'bɪn',
  by: 'bI', it: 'ɪt', its: 'ɪts', that: 'ðæt', than: 'ðæn', with: 'wɪð', your: 'jʊɹ', you: 'ju', we: 'wi', he: 'hi',
  she: 'ʃi', they: 'ðA', them: 'ðɛm', his: 'hɪz', her: 'hɜɹ', our: 'Wəɹ', me: 'mi', my: 'mI', i: 'I', do: 'du',
  does: 'dʌz', can: 'kæn', has: 'hæz', have: 'hæv', had: 'hæd', will: 'wɪl', would: 'wʊd', should: 'ʃʊd', could: 'kʊd',
  if: 'ɪf', so: 'sO', up: 'ʌp', into: 'ɪntu',
  read: 'ɹˈid', live: 'lˈɪv', lead: 'lˈid', wind: 'wˈɪnd',
};

const functionWord = (w: string): string | null => (Object.prototype.hasOwnProperty.call(FUNCTION_WORDS, w) ? FUNCTION_WORDS[w] : null);

const LETTERS = [
  'EY1', 'B IY1', 'S IY1', 'D IY1', 'IY1', 'EH1 F', 'JH IY1', 'EY1 CH', 'AY1', 'JH EY1', 'K EY1', 'EH1 L', 'EH1 M', 'EH1 N', 'OW1', 'P IY1', 'K Y UW1',
  'AA1 R', 'EH1 S', 'T IY1', 'Y UW1', 'V IY1', 'D AH1 B AH0 L Y UW0', 'EH1 K S', 'W AY1', 'Z IY1',
];

const isAsciiAlpha = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

function spell(word: string): string[] {
  const letters = [...word].filter(isAsciiAlpha).map((c) => c.toLowerCase());
  const out: string[] = [];
  letters.forEach((c, k) => {
    const last = k + 1 === letters.length;
    for (const p of LETTERS[c.charCodeAt(0) - 97].split(' ')) out.push(!last && p.endsWith('1') ? p.replace('1', '2') : p);
  });
  return out;
}

const arpa = (s: string): string[] => s.split(' ').filter(Boolean);
const lastBase = (phones: string[]): string => (phones.length ? splitStress(phones[phones.length - 1])[0] : '');

function addS(stem: string[]): string[] {
  const b = lastBase(stem);
  if (['S', 'Z', 'SH', 'ZH', 'CH', 'JH'].includes(b)) return [...stem, 'IH0', 'Z'];
  if (['P', 'T', 'K', 'F', 'TH'].includes(b)) return [...stem, 'S'];
  return [...stem, 'Z'];
}

function addEd(stem: string[]): string[] {
  const b = lastBase(stem);
  if (b === 'T' || b === 'D') return [...stem, 'IH0', 'D'];
  if (['P', 'K', 'F', 'TH', 'S', 'SH', 'CH'].includes(b)) return [...stem, 'T'];
  return [...stem, 'D'];
}

const isV = (c: string | undefined): boolean => c !== undefined && 'aeiou'.includes(c);

function stems(base: string, vowelSuffix: boolean): string[] {
  const n = base.length;
  const cvc = vowelSuffix && n >= 3 && !isV(base[n - 1]) && !'wxy'.includes(base[n - 1]) && isV(base[n - 2]) && !isV(base[n - 3]);
  const v = cvc ? [`${base}e`, base] : [base, `${base}e`];
  if (n >= 3 && base[n - 1] === base[n - 2]) v.push(base.slice(0, -1));
  if (base.endsWith('i')) v.push(`${base.slice(0, -1)}y`);
  return v;
}

function dictStem(base: string, vowelSuffix: boolean): string[] | null {
  if (base.length < 2) return null;
  for (const s of stems(base, vowelSuffix)) {
    const p = cmu(s);
    if (p !== null) return arpa(p);
  }
  return null;
}

const SUFFIXES: Array<[string, string]> = [
  ['ing', 'IH0 NG'],
  ['ers', 'ER0 Z'],
  ['er', 'ER0'],
  ['est', 'AH0 S T'],
  ['ly', 'L IY0'],
  ['ness', 'N AH0 S'],
  ['ment', 'M AH0 N T'],
  ['ful', 'F AH0 L'],
  ['less', 'L AH0 S'],
  ['y', 'IY0'],
];
const PREFIXES: Array<[string, string]> = [
  ['un', 'AH0 N'],
  ['re', 'R IY0'],
  ['pre', 'P R IY0'],
  ['over', 'OW2 V ER0'],
  ['out', 'AW2 T'],
];

function morphology(w: string): string[] | null {
  if (w.endsWith("'s") || w.endsWith("s'")) {
    const p = lookupArpa(w.slice(0, -2), 1);
    return p && addS(p);
  }
  if (w.endsWith("in'")) {
    const p = lookupArpa(`${w.slice(0, -3)}ing`, 1);
    if (p && lastBase(p) === 'NG') {
      p.pop();
      p.push('N');
    }
    return p;
  }
  if (w.endsWith('ies')) {
    const p = cmu(`${w.slice(0, -3)}y`);
    if (p !== null) return addS(arpa(p));
  }
  if (w.endsWith('es')) {
    const b = w.slice(0, -2);
    if (/[sxz]$/.test(b) || b.endsWith('ch') || b.endsWith('sh')) {
      const p = cmu(b);
      if (p !== null) return addS(arpa(p));
    }
  }
  if (w.endsWith('s')) {
    const b = w.slice(0, -1);
    if (!b.endsWith('s')) {
      const p = lookupArpa(b, 1);
      if (p) return addS(p);
    }
  }
  if (w.endsWith('ed')) {
    const p = dictStem(w.slice(0, -2), true);
    if (p) return addEd(p);
  }
  for (const [suf, ph] of SUFFIXES) {
    if (w.endsWith(suf)) {
      const p = dictStem(w.slice(0, -suf.length), 'aeiouy'.includes(suf[0]));
      if (p) return [...p, ...arpa(ph)];
    }
  }
  for (const [pre, ph] of PREFIXES) {
    if (w.startsWith(pre)) {
      const b = w.slice(pre.length);
      if (b.length >= 3) {
        const p = cmu(b);
        if (p !== null) return [...arpa(ph), ...arpa(p)];
      }
    }
  }
  return null;
}

function compound(w: string): string[] | null {
  const n = w.length;
  if (n < 6 || !/^[\x00-\x7f]*$/.test(w)) return null;
  let best: [number, string[]] | null = null;
  for (let i = 3; i <= n - 3; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    const pa = cmu(a);
    if (pa === null) continue;
    const cb = cmu(b);
    const pb = cb !== null ? arpa(cb) : morphology(b);
    if (!pb) continue;
    const score = Math.min(a.length, b.length);
    if (!best || score > best[0]) best = [score, [...arpa(pa), ...pb.map((p) => (p.endsWith('1') ? p.replace('1', '2') : p))]];
  }
  return best && best[1];
}

function lookupArpa(w: string, depth: number): string[] | null {
  const p = cmu(w);
  if (p !== null) return arpa(p);
  if (depth === 0) return null;
  return morphology(w) ?? compound(w);
}

export type Source = 'function' | 'dictionary' | 'derived' | 'spelled' | 'rules';

const ALPHA = /\p{Alphabetic}/u;
const UPPER = /\p{Uppercase}/u;

export function word(original: string): [string, Source] {
  let w = original.toLowerCase().replace(/^'+/, '');
  while (w.endsWith("'") && !(w.endsWith("in'") || w.endsWith("s'"))) w = w.slice(0, -1);
  if (!w) return ['', 'rules'];
  const fw = functionWord(w);
  if (fw !== null) return [fw, 'function'];
  const letters = [...original].filter((c) => ALPHA.test(c));
  const allCaps = letters.length >= 2 && letters.every((c) => UPPER.test(c));
  const hasVowel = /[aeiouy]/.test(w);
  if (allCaps && letters.length <= 5 && (!hasVowel || cmu(w) === null)) return [arpabetToKokoro(spell(w)), 'spelled'];
  const p = cmu(w);
  if (p !== null) return [arpabetToKokoro(arpa(p)), 'dictionary'];
  const d = lookupArpa(w, 1);
  if (d) return [arpabetToKokoro(d), 'derived'];
  if (w.length === 1 && isAsciiAlpha(w)) return [arpabetToKokoro(spell(w)), 'spelled'];
  const ascii = [...w].filter((c) => c >= 'a' && c <= 'z').join('');
  if (!ascii) return ['', 'rules'];
  return [arpabetToKokoro(wordToArpabet(ascii)), 'rules'];
}

type Tok = { word: string; spoken: string[] } | { punct: string };

const ABBREVIATIONS: Record<string, string> = {
  mr: 'mister', mrs: 'missus', ms: 'miz', dr: 'doctor', st: 'saint', jr: 'junior', sr: 'senior', vs: 'versus',
  etc: 'et cetera', prof: 'professor', feat: 'featuring', ft: 'featuring', approx: 'approximately', no: 'number', vol: 'volume', mt: 'mount',
};

function abbreviation(w: string): string | null {
  const l = w.toLowerCase();
  return Object.prototype.hasOwnProperty.call(ABBREVIATIONS, l) ? ABBREVIATIONS[l] : null;
}

function normalizeChars(text: string): string {
  let s = '';
  for (const c of text) {
    switch (c) {
      case '‘': case '’': case 'ʼ': case '`': case '´': s += "'"; break;
      case '“': case '”': case '„': case '«': case '»': s += '"'; break;
      case '–': s += '-'; break;
      case '—': case '―': s += ' — '; break;
      case '\t': case '\r': s += ' '; break;
      default: s += c;
    }
  }
  return s.split('--').join(' — ').split('...').join('…');
}

const ALNUM = /[\p{Alphabetic}\p{Nd}]/u;
const isAlnum = (c: string): boolean => ALNUM.test(c);
const isWs = (c: string): boolean => /\s/u.test(c);

export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of normalizeChars(text).split('\n')) {
    const chars = [...line];
    let start = 0;
    let i = 0;
    while (i < chars.length) {
      if ('.!?…'.includes(chars[i])) {
        let j = i + 1;
        while (j < chars.length && '.!?…")\''.includes(chars[j])) j++;
        const atBreak = j >= chars.length || isWs(chars[j]);
        let k = i;
        while (k > start && isAlnum(chars[k - 1])) k--;
        const before = chars.slice(k, i);
        const abbrev = chars[i] === '.' && (abbreviation(before.join('')) !== null || (before.length === 1 && UPPER.test(before[0])));
        const decimal = chars[i] === '.' && i > 0 && /[0-9]/.test(chars[i - 1]) && /[0-9]/.test(chars[i + 1] ?? '');
        if (atBreak && !abbrev && !decimal) {
          const s = chars.slice(start, j).join('').trim();
          if (s) out.push(s);
          start = j;
        }
        i = j;
      } else i++;
    }
    const s = chars.slice(start).join('').trim();
    if (s) out.push(s);
  }
  return out;
}

const SYMBOLS: Record<string, string> = { '&': 'and', '+': 'plus', '@': 'at', '=': 'equals', '%': 'percent', '#': 'number' };

function spokenCore(core: string, out: Tok[]): void {
  if (!core) return;
  const pushWords = (display: string, words: string): void => {
    const ws = words.split(/\s+/).filter(Boolean);
    if (ws.length) out.push({ word: display, spoken: ws });
  };
  if (Object.prototype.hasOwnProperty.call(SYMBOLS, core)) return pushWords(core, SYMBOLS[core]);
  if (core.startsWith('$')) {
    let num = core.slice(1);
    let mult = '';
    if (/[kK]$/.test(num)) [num, mult] = [num.slice(0, -1), ' thousand'];
    else if (/[mM]$/.test(num)) [num, mult] = [num.slice(0, -1), ' million'];
    const dot = num.indexOf('.');
    if (dot >= 0) {
      const dollars = parseUint(num.slice(0, dot).replace(/,/g, ''));
      const c = num.slice(dot + 1);
      const cents = parseUint(c);
      if (dollars !== null && cents !== null && c.length === 2 && !mult) {
        const dw = `${cardinal(dollars)} ${dollars === 1 ? 'dollar' : 'dollars'}`;
        return pushWords(core, cents === 0 ? dw : `${dw} ${cardinal(cents)} ${cents === 1 ? 'cent' : 'cents'}`);
      }
    }
    const words = spellToken(num);
    if (words !== null) return pushWords(core, `${words}${mult} ${num === '1' && !mult ? 'dollar' : 'dollars'}`);
  }
  const spelled = spellToken(core);
  if (spelled !== null) return pushWords(core, spelled);
  if (/[-/_]/.test(core)) {
    for (const part of core.split(/[-/_]/)) spokenCore(part, out);
    return;
  }
  if (/[0-9]/.test(core) && ALPHA.test(core)) {
    let run = '';
    let digitRun = false;
    for (const c of core) {
      const d = c >= '0' && c <= '9';
      if (run && d !== digitRun) {
        spokenCore(run, out);
        run = '';
      }
      digitRun = d;
      run += c;
    }
    spokenCore(run, out);
    return;
  }
  const cleaned = [...core].filter((c) => isAlnum(c) || c === "'").join('');
  if (!cleaned.replace(/^'+|'+$/g, '')) return;
  out.push({ word: core, spoken: [cleaned] });
}

const LEADING = '"([{\'*¿¡';
const TRAILING = ',.!?;:…")]}*\'';

function tokenize(sentence: string): Tok[] {
  const out: Tok[] = [];
  const words = normalizeChars(sentence).split(/\s+/u).filter(Boolean);
  words.forEach((chunk, k) => {
    if (chunk === '—') {
      out.push({ punct: '—' });
      return;
    }
    const chars = [...chunk];
    let a = 0;
    let b = chars.length;
    while (a < b && LEADING.includes(chars[a])) {
      if (chars[a] === '"' || chars[a] === '(') out.push({ punct: chars[a] });
      a++;
    }
    const trailingRev: string[] = [];
    while (b > a && TRAILING.includes(chars[b - 1])) {
      if (chars[b - 1] === "'" && b - 1 > a && (chars[b - 2] === 'n' || chars[b - 2] === 's')) break;
      trailingRev.push(chars[b - 1]);
      b--;
    }
    const core = chars.slice(a, b).join('');
    const trailing = trailingRev.reverse();
    const abbr = abbreviation(core);
    if (trailing[0] === '.' && abbr !== null && k + 1 < words.length) {
      out.push({ word: `${core}.`, spoken: abbr.split(' ') });
      trailing.shift();
    } else spokenCore(core, out);
    for (const c of trailing) {
      if (',.!?;:…")'.includes(c)) out.push({ punct: c });
      else if (c === ']' || c === '}') out.push({ punct: ')' });
    }
  });
  return out;
}

export interface WordSpan {
  text: string;
  start: number;
  end: number;
}

export interface Phonemized {
  phonemes: string;
  words: WordSpan[];
}

const VOWEL_PHONEMES = 'AIOWYaeiouæɑɐɒɔəɛɜɪʊʌᵻ';

function startsWithVowel(ph: string): boolean {
  const c = [...ph].find((x) => x !== 'ˈ' && x !== 'ˌ');
  return c !== undefined && VOWEL_PHONEMES.includes(c);
}

const cpLen = (s: string): number => [...s].length;

export function phonemize(sentence: string): Phonemized {
  const toks = tokenize(sentence);
  const wordPh: Array<string | null> = toks.map((t) =>
    'word' in t
      ? t.spoken
          .map((w) => word(w)[0])
          .filter(Boolean)
          .join(' ')
      : null,
  );
  toks.forEach((t, i) => {
    if ('word' in t && t.spoken.length === 1 && t.spoken[0].toLowerCase() === 'the') {
      const next = wordPh.slice(i + 1).find((p) => p !== null);
      if (next != null && startsWithVowel(next)) wordPh[i] = 'ði';
    }
  });
  const out: Phonemized = { phonemes: '', words: [] };
  let len = 0;
  let openQuote = false;
  const push = (s: string): void => {
    out.phonemes += s;
    len += cpLen(s);
  };
  const spaceBefore = (): void => {
    if (out.phonemes && !out.phonemes.endsWith(' ')) push(' ');
  };
  toks.forEach((t, i) => {
    if ('word' in t) {
      const ph = wordPh[i] ?? '';
      if (!ph) return;
      const last = out.phonemes.slice(-1);
      if (last && last !== ' ' && last !== '(' && !(last === '"' && openQuote)) push(' ');
      const start = len;
      push(ph);
      out.words.push({ text: t.word, start, end: len });
      return;
    }
    const c = t.punct;
    if (c === '(') {
      spaceBefore();
      push('(');
    } else if (c === '"') {
      if (!openQuote) spaceBefore();
      push('"');
      openQuote = !openQuote;
    } else if (c === '—') {
      spaceBefore();
      push('—');
    } else if (out.phonemes) {
      push(c);
    }
  });
  return out;
}

const SPLIT_PUNCT = ',;:—.!?';

export function splitLong(p: Phonemized, max: number): Phonemized[] {
  const chars = [...p.phonemes];
  if (chars.length <= max) return [p];
  const pieces: Array<[number, number]> = [];
  let start = 0;
  while (chars.length - start > max) {
    const window = chars.slice(start, start + max);
    let cut = -1;
    for (let i = window.length - 1; i >= 0; i--) {
      if (SPLIT_PUNCT.includes(window[i])) {
        if (i > Math.floor(max / 3)) cut = i + 1;
        break;
      }
    }
    if (cut < 0) {
      const sp = window.lastIndexOf(' ');
      cut = sp > 0 ? sp : max;
    }
    pieces.push([start, start + cut]);
    start += cut;
    while (start < chars.length && chars[start] === ' ') start++;
  }
  if (start < chars.length) pieces.push([start, chars.length]);
  return pieces
    .map(([a, b]) => ({
      phonemes: chars.slice(a, b).join('').trimEnd(),
      words: p.words.filter((w) => w.start >= a && w.end <= b).map((w) => ({ text: w.text, start: w.start - a, end: w.end - a })),
    }))
    .filter((x) => x.phonemes.trim() !== '');
}

export const MAX_CHUNK = 400;

export function textChunks(text: string): Phonemized[] {
  return sentences(text)
    .map(phonemize)
    .filter((p) => p.phonemes.trim() !== '')
    .flatMap((p) => splitLong(p, MAX_CHUNK));
}
