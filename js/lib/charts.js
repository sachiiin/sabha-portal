// ApexCharts helpers. Kept here so every chart in the portal shares one
// set of defaults and reads the same colours as the rest of the theme.

const BRAND = { light: '#c8651a', dark: '#e8944a' };

export const STATUS_COLOURS = {
  present: '#2f855a',
  late:    '#c8651a',
  excused: '#2b6cb0',
  absent:  '#c53030'
};

function isDark() {
  return document.documentElement.getAttribute('data-bs-theme') === 'dark';
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function base() {
  const dark = isDark();
  return {
    chart: {
      fontFamily: 'inherit',
      foreColor: cssVar('--tblr-secondary', dark ? '#9aa0a6' : '#6b6b66'),
      toolbar: { show: false },
      animations: { enabled: true, speed: 350 },
      parentHeightOffset: 0
    },
    grid: {
      borderColor: cssVar('--tblr-border-color', dark ? '#3a3a36' : '#e9e7e1'),
      strokeDashArray: 4,
      padding: { left: 4, right: 4, top: 0, bottom: 0 }
    },
    dataLabels: { enabled: false },
    tooltip: { theme: dark ? 'dark' : 'light' },
    legend: { show: false }
  };
}

// Attendance over time — a gradient area, which reads as a trend at a
// glance rather than asking anyone to compare bar heights.
export function areaChart(el, { labels, values, total }) {
  const dark = isDark();
  const colour = dark ? BRAND.dark : BRAND.light;

  const opts = {
    ...base(),
    chart: { ...base().chart, type: 'area', height: 260, sparkline: { enabled: false } },
    series: [{ name: 'Attended', data: values }],
    colors: [colour],
    stroke: { curve: 'smooth', width: 3, lineCap: 'round' },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: dark ? 0.45 : 0.4,
        opacityTo: 0,
        stops: [0, 95]
      }
    },
    markers: { size: 0, hover: { size: 5 } },
    xaxis: {
      categories: labels,
      tooltip: { enabled: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { rotate: 0, hideOverlappingLabels: true }
    },
    yaxis: {
      min: 0,
      max: Math.max(total, 1),
      tickAmount: Math.min(Math.max(total, 1), 5),
      labels: { formatter: (v) => Math.round(v) }
    },
    tooltip: {
      ...base().tooltip,
      y: {
        formatter: (v) => `${Math.round(v)} of ${total}`,
        title: { formatter: () => 'Attended' }
      }
    }
  };

  const chart = new ApexCharts(el, opts);
  chart.render();
  return chart;
}

// One yuvak, sabha by sabha. Every column is one sabha, coloured by the
// mark, so a run of absences is visible at a glance. The height carries
// no meaning beyond "there was a sabha", so the y-axis stays hidden.
export function memberChart(el, { labels, marks, notMarked = [] }) {
  const opts = {
    ...base(),
    chart: { ...base().chart, type: 'bar', height: 260 },
    series: [{ name: 'Mark', data: marks.map(() => 1) }],
    colors: marks.map((s) => STATUS_COLOURS[s] ?? '#b9b5ad'),
    plotOptions: {
      bar: { columnWidth: marks.length > 24 ? '72%' : '46%', borderRadius: 4, distributed: true }
    },
    stroke: { width: 0 },
    xaxis: {
      categories: labels,
      tooltip: { enabled: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { rotate: 0, hideOverlappingLabels: true }
    },
    yaxis: { show: false, min: 0, max: 1 },
    tooltip: {
      ...base().tooltip,
      y: {
        formatter: (_v, { dataPointIndex }) => {
          const s = marks[dataPointIndex];
          const label = s ? s[0].toUpperCase() + s.slice(1) : 'Not marked';
          const note = notMarked[dataPointIndex];
          return note ? `${label} — ${note}` : label;
        },
        title: { formatter: () => '' }
      }
    }
  };

  const chart = new ApexCharts(el, opts);
  chart.render();
  return chart;
}

// How the marks break down across every sabha in view.
export function donutChart(el, counts) {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0);

  const opts = {
    ...base(),
    chart: { ...base().chart, type: 'donut', height: 240 },
    series: keys.map((k) => counts[k]),
    labels: keys.map((k) => k[0].toUpperCase() + k.slice(1)),
    colors: keys.map((k) => STATUS_COLOURS[k]),
    stroke: { width: 0 },
    plotOptions: {
      pie: {
        donut: {
          size: '74%',
          labels: {
            show: true,
            name: { fontSize: '0.8rem' },
            value: { fontSize: '1.4rem', fontWeight: 500, formatter: (v) => v },
            total: {
              show: true,
              label: 'Marks',
              fontSize: '0.8rem',
              formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0)
            }
          }
        }
      }
    },
    legend: {
      show: true,
      position: 'bottom',
      horizontalAlign: 'center',
      markers: { radius: 12 },
      itemMargin: { horizontal: 8, vertical: 2 }
    },
    tooltip: { ...base().tooltip, y: { formatter: (v) => `${v} marks` } }
  };

  const chart = new ApexCharts(el, opts);
  chart.render();
  return chart;
}
