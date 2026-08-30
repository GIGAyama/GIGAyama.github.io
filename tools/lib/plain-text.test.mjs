/**
 * ふりがなの落とし方のテスト。
 *
 * ここが効かないと、子ども向けアプリのマニュアルで目次が
 * 「1ねん学がく年ねんから6ねん学がく年ねんまで」になる。
 * 検索の索引と SNS カードの説明文にも同じ文字列が入るので、
 * 気づいたときには 3 か所で同時に崩れている。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainText, rubyOnly, stripRuby } from './plain-text.mjs';

const RUBY = '<ruby>学年<rt>がくねん</rt></ruby>';

test('ふりがなは中身ごと落ちる。漢字は残る', () => {
  assert.equal(plainText(RUBY), '学年');
  assert.equal(stripRuby(RUBY), '学年');
});

test('ふりがな用のかっこ（rp）も落ちる', () => {
  // ruby に対応しない環境むけに「（）」を置く書き方
  const src = '<ruby>計算<rp>（</rp><rt>けいさん</rt><rp>）</rp></ruby>';
  assert.equal(plainText(src), '計算');
});

test('1 つの見出しに複数のふりがながあっても、まとめて落ちない', () => {
  // 貪欲な正規表現だと最初の <rt> から最後の </rt> までを飲みこみ、
  // あいだの漢字（「から」「まで」）まで消える
  const src = `1<ruby>年<rt>ねん</rt></ruby>から6<ruby>年<rt>ねん</rt></ruby>まで`;
  assert.equal(plainText(src), '1年から6年まで');
});

test('ふりがな以外のタグも外れる', () => {
  assert.equal(plainText(`${RUBY}を<code>えらぶ</code>`), '学年をえらぶ');
});

test('実体参照は戻さない（そのまま HTML に置ける形で返す）', () => {
  // 目次はこの文字列をそのまま <a> の中に入れる。戻すと二重エスケープが崩れる
  assert.equal(plainText('A&amp;B'), 'A&amp;B');
});

test('ふりがなが無ければ、これまでどおりタグを外すだけ', () => {
  assert.equal(plainText('<strong>はじめに</strong>'), 'はじめに');
});

test('rubyOnly はふりがなだけ残して、ほかのタグを外す', () => {
  // 目次のリンクの中身。<a> の中に <a> を入れられないので外す
  assert.equal(rubyOnly(`${RUBY}を<a href="/x">えらぶ</a>`), `${RUBY}をえらぶ`);
});

test('空・未定義でも落ちない', () => {
  assert.equal(plainText(''), '');
  assert.equal(plainText(null), '');
  assert.equal(plainText(undefined), '');
  assert.equal(rubyOnly(undefined), '');
});

test('何度通しても結果が変わらない', () => {
  assert.equal(plainText(plainText(RUBY)), plainText(RUBY));
  assert.equal(rubyOnly(rubyOnly(RUBY)), rubyOnly(RUBY));
});

test('閉じタグを省いた <rt> も落とす', () => {
  // HTML では </rt> </rp> を省ける。ブラウザも、組み立て（article-md.mjs）も
  // この形をそのまま通すので、落とし損ねると目次と索引にだけ「学年がくねん」が残る
  assert.equal(plainText('<ruby>学年<rt>がくねん</ruby>'), '学年');
  assert.equal(plainText('<ruby>計算<rp>(<rt>けいさん<rp>)</ruby>'), '計算');
});

test('閉じタグを省いても、続く語まで食べない', () => {
  assert.equal(plainText('<ruby>学年<rt>がくねん</ruby>で しぼる'), '学年で しぼる');
  assert.equal(plainText('1<ruby>年<rt>ねん</ruby>から6<ruby>年<rt>ねん</ruby>まで'),
    '1年から6年まで');
});
