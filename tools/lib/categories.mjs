/**
 * カテゴリと「つかいかた」の表。
 *
 * 表示名と色は index.html のカード（class="tag" と style="--cat:…"）と
 * そろえてある。更新情報と紹介ページの一覧の両方で使うので、
 * 2 か所に同じ表を置かず、ここを正本にする。
 *
 * 「つかいかた」の表示名は、これまで index.html の選択肢の中にしか無かった。
 * 紹介ページでも使うので、こちらに移した。ずれていないかは
 * tools/check-cards.mjs が index.html の選択肢と突き合わせて見ている。
 */

export const CATEGORY_LABEL = {
  kokugo: '国語・言葉', sansu: '算数', tankyu: '学習・探究', gakkyu: '学級経営',
  koumu: '授業づくり・校務', seisaku: '表現・制作', game: 'ゲーム・対戦', other: 'そのほか',
};

export const CATEGORY_COLOR = {
  kokugo: '#c96a2e', sansu: '#3b82d6', tankyu: '#1d9c9c', gakkyu: '#9a63c9',
  koumu: '#5b7f9e', seisaku: '#cd5a86', game: '#4a9e5c', other: '#8b93a1',
};

export const USE_LABEL = {
  susumu: '自分で進める', renshu: '練習する', shiraberu: '調べる', tsukuru: 'つくる',
  furikaeru: 'ふりかえる', minna: 'みんなでやる', sensei: '先生の仕事', hoka: 'そのほか',
};
