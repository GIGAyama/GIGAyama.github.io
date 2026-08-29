#!/usr/bin/env node
/**
 * lint-manual.mjs — 使い方マニュアルの書式を見る
 *
 *   node lint-manual.mjs docs/manual/manual.md
 *   node lint-manual.mjs docs/manual/manual.md --json
 *
 * 見るのは「機械が頼っているところ」だけ。文章の良し悪しは見ない。
 *
 * ── なぜ要るのか ────────────────────────────────
 *
 * このファイルは giga-school.com/apps/<slug>/manual/ に毎朝組み直される。
 * 見出しの並びから目次と検索の索引が作られ、画像の書き方から画面写真の
 * 出し先が決まる。**外しても、手元では何も起きない。** 気づくのは翌朝、
 * 公開されたページが崩れてからになる。
 *
 * ⚠️ 落とすのは「機械が拾えなくなるもの」だけにする。書き方の好みで
 *    落とすと、書き手はこの検査を通さなくなる。
 */
import { readFileSync } from 'node:fs';

/**
 * 中身の無い見出し。これだけでは何の説明か分からないので落とす。
 *
 * ⚠️ 2026-08-29 まで、この検査は「## は はじめに／さいしょに／画面の見かた／
 *    できること／こまったとき の 5 つだけ」と決め打ちしていた。理由として
 *    「機械がこの並びを前提に目次と索引を作る」と書いてあったが、それは誤りだった。
 *    目次も索引も見出しの**位置**（s-1, s-2）しか見ておらず、名前は一度も見ていない。
 *
 *    害のほうが大きかった。5 つに押しこむと、機能がいくつあっても全部が
 *    「できること」の下にぶら下がる。週案エディタでは 16 機能がそうなっていた。
 *    いまは章立てを自由にし、代わりに**名前の質**を見る。
 */
const EMPTY_NAMES = [
  'できること', 'その他', 'そのほか', '機能', '応用', 'いろいろ', '補足', 'メモ',
  'はじめに以外', '各種機能', 'その他の設定', 'まとめ',
];

/** 見出しの短さの下限。参照マニュアルの見出しは平均 14.8 字ある。 */
const HEADING_MIN = 5;

/** 短くても意味の通る、決まりきった名前。参照マニュアルも「1. はじめに」を使っている。 */
const CONVENTIONAL = ['はじめに', 'おわりに', 'まとめ以外'];

/** 機械が足す節。手で書かれていたら止める（/filtering/ と食い違うため） */
const MACHINE_SECTIONS = ['学校で使うときは', '学校で使うときの準備', '変わったこと', '更新履歴'];

/** キャプションと見分けられる長さ。tools/lib/article-md.mjs の CAPTION_MAX_CHARS と同じ */
const CAPTION_MAX = 120;

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const ORDERED = /^\s*\d+\.\s/;

/**
 * @param {string} md マニュアルの中身
 * @returns {{level: 'error'|'warn', line: number, message: string}[]}
 */
export function lintManual(md) {
  const out = [];
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const say = (level, line, message) => out.push({ level, line, message });

  /* 囲み（```）の中は本文ではない。手順の例を書けなくなるので飛ばす */
  const fenced = new Set();
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { inFence = !inFence; fenced.add(i); return; }
    if (inFence) fenced.add(i);
  });

  const heads = [];
  lines.forEach((l, i) => {
    if (fenced.has(i)) return;
    const m = HEADING.exec(l);
    if (m) heads.push({ level: m[1].length, text: m[2], line: i + 1 });
  });

  /* --- 題 ------------------------------------------------------- */
  const h1 = heads.filter((h) => h.level === 1);
  if (h1.length === 0) say('error', 1, '題（# ではじまる行）が無い。ページの題になる');
  if (h1.length > 1) {
    h1.slice(1).forEach((h) => say('error', h.line, `# は 1 本だけ。2 本目は ## にする（「${h.text}」）`));
  }
  if (h1.length && h1[0].line !== heads[0]?.line) {
    say('error', h1[0].line, '# は、いちばん最初の見出しにする');
  }

  /* --- ## の並び ------------------------------------------------ */
  const h2 = heads.filter((h) => h.level === 2);
  const names = h2.map((h) => h.text);

  for (const bad of MACHINE_SECTIONS) {
    const hit = h2.find((h) => h.text.includes(bad));
    if (hit) {
      say('error', hit.line,
        `「${bad}」は書かない。data/apps.json と docs/CHANGELOG.md から機械が足す。`
        + '手で書くと giga-school.com/filtering/ と食い違う');
    }
  }

  /* 章が少なすぎる。機能ごとに章を立てていない形になっている */
  if (h2.length < 3) {
    say('error', h2[0]?.line ?? 1,
      `章（##）が ${h2.length} つしかない。機能のまとまりごとに章を立てる`
      + '（基準にした実物のマニュアルは 10 章 25 節）');
  }

  /* 見出しの名前の質。「見出しだけを並べて、何の説明か分かる」が唯一の基準 */
  for (const h of heads) {
    if (h.level < 2) continue;
    const name = h.text.replace(/^[【（(]?[!！重要①-⑳\s]*[】）)]?\s*/, '').trim();
    if (EMPTY_NAMES.includes(name)) {
      say('error', h.line,
        `「${h.text}」だけでは何の説明か分からない。`
        + '何を・どうするのかが分かる名前にする（例「週案のセルから単元を選ぶ」）');
      continue;
    }
    if (name.length < HEADING_MIN && !CONVENTIONAL.includes(name)) {
      say('warn', h.line,
        `見出し「${h.text}」が ${name.length} 字と短い。`
        + '目次に並べたときに中身が分かるか確かめる');
    }
  }

  /* 見出しに自分で番号を振らない。ページ側の目次が振るので二重になる */
  for (const h of heads) {
    /* 「1. 」「1、」と「3.1 」「3.1. 」を拾う。
       ⚠️ ただの数字ではじまる見出し（「2 学期のはじめにすること」）は通す。
          点が無ければ、それは番号ではなく言葉の一部である。 */
    const NUMBERED = /^\s*(?:\d+[.、][ \u3000]|\d+(?:\.\d+)+[.、]?[ \u3000])/;
    if (h.level >= 2 && NUMBERED.test(h.text)) {
      say('error', h.line,
        `見出しに番号を書かない（「${h.text}」）。ページの目次が自動で振るので二重になる`);
    }
  }

  /* 読む前に用意するものが書かれているか。ここが抜けていると、
     読み手は最初の 1 行で止まる（参照マニュアル 1.3 にあたる） */
  const body = lines.filter((l, i) => !fenced.has(i)).join('\n');
  if (!/用意|準備|お手元|必要なもの|そろえ/.test(body)) {
    say('warn', 1,
      '読む前に用意するもの（端末・アカウント・URL・権限）が見あたらない。'
      + '手元に何が要るかが分からないと、最初の 1 行で止まる');
  }

  /* 章が大きくなりすぎていないか。節が多すぎる章は、章を割るべき形になっている */
  const perChapter = new Map();
  let cur = null;
  for (const h of heads) {
    if (h.level === 2) { cur = h; perChapter.set(h, []); continue; }
    if (h.level >= 3 && cur) perChapter.get(cur).push(h);
  }
  for (const [chapter, subs] of perChapter) {
    /* ⚠️ しきい値をきつくしない。「こまったとき」のように、同じ種類のものが
       9 つ並ぶ章は正しい形である（症状ごとに引けるほうがよい）。
       止めたいのは「機能を 16 個ぶら下げた 1 章」のほうなので、そこだけ鳴る値にする。 */
    if (subs.length > 10) {
      say('warn', chapter.line,
        `「${chapter.text}」に節が ${subs.length} つある。`
        + '同じ種類のものが並んでいるなら、このままでよい。'
        + '別々の機能が並んでいるなら、機能のまとまりで章を割る');
    }
  }

  /* --- 画像 ----------------------------------------------------- */
  let images = 0;
  lines.forEach((l, i) => {
    if (fenced.has(i)) return;
    const at = i + 1;

    if (/!\[[^\]]*\]\([^)]*\)/.test(l) && !IMAGE_LINE.test(l)) {
      say('error', at, '画像は 1 行に 1 枚、行頭から書く。文の中に混ぜたものは拾われない');
      return;
    }
    const m = IMAGE_LINE.exec(l);
    if (!m) return;
    images++;
    const [, alt, src] = m;
    if (!alt.trim()) say('error', at, 'alt を空にしない。読み上げと、ページの説明に使う');
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')) {
      say('error', at, `画像は images/ の相対指定にする（いまは ${src}）。外のアドレスは渡せない`);
    } else if (!src.startsWith('images/')) {
      say('error', at, `画像は images/ に置く（いまは ${src}）`);
    }

    /* ⚠️ 2026-08-29 まで、ここは「番号つき手順の途中に画像を置かない」を
       落としていた。組み立てがそこで番号を切っていたためだが、押す場所の写真は
       手順のあいだにあるのがいちばん自然なので、組み立ての側を直した
       （tools/lib/article-md.mjs が <ol start="N"> で続ける）。検査からは外す。

       ただし続くのは「画像と、その説明文だけ」をはさんだときに限るので、
       手順のあいだにふつうの段落を置いたときだけ、番号が戻ることを知らせる。 */
    const before = lines.slice(0, i).reverse().find((x) => x.trim() !== '');
    if (ORDERED.test(before ?? '')) {
      const rest = lines.slice(i + 1);
      const nextAt2 = rest.findIndex((x) => x.trim() !== '');
      const next2 = nextAt2 === -1 ? '' : rest[nextAt2].trim();
      const isCaption = next2 && !HEADING.test(next2) && !IMAGE_LINE.test(next2)
        && !ORDERED.test(next2) && next2.length <= CAPTION_MAX;
      const after2 = isCaption
        ? rest.slice(nextAt2 + 1).find((x) => x.trim() !== '') ?? ''
        : next2;
      if (after2 && !ORDERED.test(after2) && !HEADING.test(after2) && !IMAGE_LINE.test(after2)
          && after2.trim().length > CAPTION_MAX) {
        say('warn', at, '手順のあいだに置けるのは、画像と 120 字までの説明文だけ。'
          + 'それより長い段落を置くと、次の手順の番号が 1 に戻る');
      }
    }

    /* キャプションは、画像の直後の「1 行だけの段落」で、120 字まで
       （tools/lib/article-md.mjs の looksLikeCaption と同じ条件）。
       ⚠️ 直後の段落すべてを見ない。画像のあとにふつうの本文が続くのは当たり前で、
          それを毎回警告すると、この検査を誰も読まなくなる。
          「キャプションのつもりで書いたのに、少しだけ長い」ところだけを言う。 */
    const nextAt = lines.findIndex((x, j) => j > i && x.trim() !== '');
    const next = nextAt === -1 ? '' : lines[nextAt].trim();
    const alone = nextAt !== -1 && (lines[nextAt + 1] ?? '').trim() === '';
    const plain = next && !HEADING.test(next) && !IMAGE_LINE.test(next)
      && !ORDERED.test(next) && !/^\s*[-*]\s/.test(next) && !/^\s*```/.test(next);
    if (plain && alone && next.length > CAPTION_MAX && next.length <= CAPTION_MAX * 2) {
      say('warn', nextAt + 1, `画像の直後の 1 段落が ${next.length} 字。`
        + `${CAPTION_MAX} 字までならキャプションとして画像に添うが、超えると`
        + 'ふつうの本文になる（写真から離れて出る）');
    }
  });
  if (images === 0) {
    say('error', 1, '画面写真が 1 枚も無い。「どのボタンを押せば何ができるか」を'
      + '伝えるのがマニュアルなので、文章だけでは公開しない');
  }

  /* --- 組み立てが扱わない書き方 ---------------------------------- */
  lines.forEach((l, i) => {
    if (fenced.has(i)) return;
    const at = i + 1;
    if (/^\s*\|.*\|\s*$/.test(l)) say('error', at, '表は組み立てが扱わない。箇条書きにする');
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) say('error', at, '水平線は組み立てが扱わない');
    if (/\*\*[^*]+\*\*/.test(l)) say('warn', at, '太字は使わない。強調は「」で足りる');
  });

  return out;
}

/* --- ここから下は道具として呼ばれたときだけ ---------------------- */
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('使い方: node lint-manual.mjs docs/manual/manual.md [--json]');
    process.exit(2);
  }
  let md;
  try {
    md = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`読めない: ${file}（${e.code}）`);
    process.exit(2);
  }
  const found = lintManual(md);
  const errors = found.filter((f) => f.level === 'error');

  if (asJson) {
    console.log(JSON.stringify({ file, ok: errors.length === 0, found }, null, 1));
  } else {
    for (const f of found) {
      console.log(`${f.level === 'error' ? '  NG  ' : '  警告'} ${file}:${f.line}  ${f.message}`);
    }
    console.log(errors.length === 0
      ? `\n✅ ${file} は組み立てられる形です（警告 ${found.length - errors.length} 件）`
      : `\n❌ ${errors.length} 件 直してください`);
  }
  process.exit(errors.length === 0 ? 0 : 1);
}
