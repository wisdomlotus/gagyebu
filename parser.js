/* 카드 승인 문자 분석기
 * 여러 카드사의 승인 문자 형식에서 날짜·시간·금액·사용처를 뽑아낸다.
 * 브라우저(self.SmsParser)와 node(module.exports) 양쪽에서 쓸 수 있다.
 */
(function (root) {
  'use strict';

  var DATE_RE = /(?:(\d{4}|\d{2})\s*[\/.\-년]\s*)?(\d{1,2})\s*[\/.\-월]\s*(\d{1,2})(?:\s*일)?/g;
  var TIME_RE = /([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?::[0-5]\d)?/g;
  var AMOUNT_RE = /(\d{1,3}(?:,\d{3})+|\d+)\s*원/g;
  var INSTALL_RE = /일시불|할부\s*\(?\s*\d*\s*(?:개월)?\s*\)?|\d{1,2}\s*개월/g;
  // 승인 금액이 아닌 금액(누적·잔액·한도 등)과 전화번호는 먼저 지운다
  var NOISE_RE = /(?:총\s*누적|월\s*누적|누적\s*(?:금액|이용)?|잔액|잔여\s*한도|사용\s*가능\s*(?:금액|한도)?|이용\s*가능\s*(?:금액|한도)?|한도|결제\s*예정\s*(?:금액)?)\s*[:：]?\s*-?\s*[\d,]+\s*원?/g;
  var PHONE_RE = /\b\d{2,4}-\d{3,4}-\d{4}\b|\b1[5-9]\d{2}-\d{4}\b/g;
  var FOREIGN_RE = /(USD|US\$|\$|JPY|EUR|CNY|GBP|HKD|THB|VND|달러|엔화|유로)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(USD|JPY|EUR|CNY|GBP|HKD|THB|VND|달러|엔|유로)/i;
  var HEADER_RE = /(카드|승인|취소|체크|web\s*발신|뱅크|\(\d{3,4}\)|\d\*\d\*|^\[.*\]$)/i;
  var HEADER_START_RE = /(카드|승인|취소|\(\d{3,4}\)|뱅크|^\[)/;
  var CARD_RE = /(KB국민|국민|신한|삼성|현대|롯데|우리|하나|NH농협|농협|NH|BC|비씨|씨티|카카오뱅크|카카오페이|토스뱅크|토스|IBK|기업|SC제일|수협|케이뱅크|우체국|새마을|신협)/;
  var MASKED_NAME_RE = /^[가-힣A-Za-z]{1,2}\*+[가-힣A-Za-z*]{0,3}(님)?$/;
  var LEFTOVER_WORDS_RE = /(^|\s)(승인취소|승인|취소|사용|결제|출금|일시불|체크|신용|해외|국내|님|누적|잔액)(?=\s|$)/g;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function findDates(s, today) {
    var out = [];
    var re = new RegExp(DATE_RE.source, 'g');
    var m;
    while ((m = re.exec(s))) {
      var mo = +m[2], d = +m[3];
      var before = s.charAt(m.index - 1), after = s.charAt(m.index + m[0].length);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      if (/\d/.test(before) || /\d/.test(after)) continue;
      var y;
      if (m[1]) {
        y = +m[1] < 100 ? 2000 + +m[1] : +m[1];
      } else {
        y = today.getFullYear();
        // 1월에 12월 문자를 붙여넣는 경우 등: 미래 날짜면 작년으로 본다
        if (new Date(y, mo - 1, d) - today > 2 * 86400000) y -= 1;
      }
      var dt = new Date(y, mo - 1, d);
      if (dt.getMonth() !== mo - 1) continue;
      out.push({ index: m.index, end: m.index + m[0].length, date: y + '-' + pad(mo) + '-' + pad(d) });
    }
    return out;
  }

  function allMatches(re, s) {
    var r = new RegExp(re.source, 'g' + (re.ignoreCase ? 'i' : ''));
    var out = [], m;
    while ((m = r.exec(s))) {
      out.push({ index: m.index, end: m.index + m[0].length, m: m });
      if (m[0].length === 0) r.lastIndex++;
    }
    return out;
  }

  function stripKnown(s) {
    var t = s
      .replace(new RegExp(DATE_RE.source, 'g'), ' ')
      .replace(new RegExp(TIME_RE.source, 'g'), ' ')
      .replace(new RegExp(AMOUNT_RE.source, 'g'), ' ')
      .replace(new RegExp(INSTALL_RE.source, 'g'), ' ');
    t = t.split(/\s+/).filter(function (tok) { return tok && !MASKED_NAME_RE.test(tok); }).join(' ');
    t = t.replace(LEFTOVER_WORDS_RE, ' ').replace(LEFTOVER_WORDS_RE, ' ');
    t = t.replace(/\(\s*\)|\[\s*\]/g, ' ');
    t = t.replace(/^[\s,.:·\-|\/~>]+|[\s,.:·\-|\/~<]+$/g, '');
    t = t.replace(/\s{2,}/g, ' ').trim();
    if (/^[\d\s*()\-.,]+$/.test(t)) return '';
    return t.slice(0, 40);
  }

  function parseMessage(raw, today) {
    today = today || new Date();
    var text = raw.replace(/\[\s*web\s*발신\s*\]/ig, '').replace(/ /g, ' ').trim();
    var cancel = /취소/.test(text) && !/취소\s*불가/.test(text);
    var cleaned = text.replace(NOISE_RE, ' ').replace(PHONE_RE, ' ');

    var dates = findDates(cleaned, today);
    var times = allMatches(TIME_RE, cleaned);
    var amounts = allMatches(AMOUNT_RE, cleaned);
    var installs = allMatches(INSTALL_RE, cleaned);
    var foreignM = cleaned.match(FOREIGN_RE);
    var cardM = text.match(CARD_RE);

    var amount = null;
    if (amounts.length) amount = parseInt(amounts[0].m[1].replace(/,/g, ''), 10);
    var foreign = null;
    if (foreignM && amount === null) foreign = foreignM[0].trim();

    // 사용처 찾기
    var lines = cleaned.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var merchant = '';
    if (lines.length >= 3) {
      for (var i = 0; i < lines.length; i++) {
        if (HEADER_RE.test(lines[i])) continue;
        var cand = stripKnown(lines[i]);
        if (cand) { merchant = cand; break; }
      }
    }
    if (!merchant) {
      var joined = lines.join(' ');
      var jd = findDates(joined, today), jt = allMatches(TIME_RE, joined),
          ja = allMatches(AMOUNT_RE, joined), ji = allMatches(INSTALL_RE, joined);
      var jf = allMatches(FOREIGN_RE, joined);
      var lastEnd = 0;
      [jd, jt, ja, ji, jf].forEach(function (arr) {
        arr.forEach(function (x) { if (x.end > lastEnd) lastEnd = x.end; });
      });
      merchant = stripKnown(joined.slice(lastEnd));
      if (!merchant) {
        var noHeader = joined.split(/\s+/).filter(function (tok) { return !HEADER_RE.test(tok); }).join(' ');
        if (foreignM) noHeader = noHeader.replace(foreignM[0], ' ');
        merchant = stripKnown(noHeader);
      }
    }

    return {
      raw: raw.trim(),
      date: dates.length ? dates[0].date : '',
      time: times.length ? pad(+times[0].m[1]) + ':' + times[0].m[2] : '',
      amount: amount,
      merchant: merchant,
      card: cardM ? cardM[1] : '',
      cancel: cancel,
      foreign: foreign,
      ok: !!(dates.length && amount !== null)
    };
  }

  function splitMessages(text, today) {
    today = today || new Date();
    var t = String(text || '').replace(/\r/g, '').replace(/ /g, ' ');
    var chunks = [];
    t.split(/\[\s*web\s*발신\s*\]/i).forEach(function (p) {
      p.split(/\n\s*\n/).forEach(function (q) { q = q.trim(); if (q) chunks.push(q); });
    });
    var out = [];
    chunks.forEach(function (c) {
      if (findDates(c, today).length <= 1) { out.push(c); return; }
      // 한 덩어리에 여러 건이 붙어 있는 경우 줄 단위로 나눈다
      var lines = c.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var cur = [], curHasDate = false;
      lines.forEach(function (l) {
        var lineHasDate = findDates(l, today).length > 0;
        var selfContained = lineHasDate && allMatches(AMOUNT_RE, l.replace(NOISE_RE, ' ')).length > 0;
        if (cur.length && curHasDate && (HEADER_START_RE.test(l) || selfContained)) {
          out.push(cur.join('\n')); cur = []; curHasDate = false;
        }
        cur.push(l);
        if (lineHasDate) curHasDate = true;
      });
      if (cur.length) out.push(cur.join('\n'));
    });
    // 숫자가 하나도 없는 조각(인사말 등)은 버린다
    return out.filter(function (c) { return /\d/.test(c); });
  }

  function parseAll(text, today) {
    return splitMessages(text, today).map(function (c) { return parseMessage(c, today); });
  }

  var api = { parseAll: parseAll, parseMessage: parseMessage, splitMessages: splitMessages };
  root.SmsParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
