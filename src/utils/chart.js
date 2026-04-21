// QuickChart.io URL 생성 (바 그래프 - 경험치율 히스토리)
function generateChartUrl(history) {
  const labels = history.map(h => {
    if (h.date === 'NOW') return 'NOW';
    const date = new Date(h.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const data = history.map(h => parseFloat(h.expRate.toFixed(2)));

  const chartConfig = {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '경험치 (%)',
        data: data,
        backgroundColor: 'rgba(242, 250, 0, 0.9)',
        borderColor: 'rgb(242, 250, 0)',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: false
        },
        datalabels: {
          display: true,
          color: '#ffffff',
          anchor: 'end',
          align: 'top',
          font: {
            weight: 'bold',
            size: 14
          },
          formatter: (value) => value + '%'
        }
      },
      scales: {
        x: {
          ticks: { color: '#ffffff', font: { size: 14 } },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          min: 0,
          max: 100,
          ticks: {
            color: '#ffffff',
            font: { size: 12 },
            stepSize: 10
          },
          grid: { color: 'rgba(255, 255, 255, 0.1)' }
        }
      }
    }
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encodedConfig}&backgroundColor=%23303030&width=1600&height=900&version=3`;
}

module.exports = { generateChartUrl };
