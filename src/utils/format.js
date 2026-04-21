function formatExpNumber(num) {
  if (num === 0) return '0';

  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '+';

  if (absNum >= 10000000000000000) { // 경 (10^16)
    return `${sign}${(absNum / 10000000000000000).toFixed(1)}경`;
  } else if (absNum >= 1000000000000) { // 조 (10^12)
    return `${sign}${(absNum / 1000000000000).toFixed(1)}조`;
  } else if (absNum >= 100000000) { // 억 (10^8)
    return `${sign}${(absNum / 100000000).toFixed(1)}억`;
  } else if (absNum >= 10000) { // 만 (10^4)
    return `${sign}${(absNum / 10000).toFixed(1)}만`;
  } else {
    return `${sign}${absNum.toFixed(0)}`;
  }
}

module.exports = { formatExpNumber };
