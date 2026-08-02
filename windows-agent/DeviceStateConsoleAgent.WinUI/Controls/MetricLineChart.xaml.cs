using DeviceStateConsoleAgent.WinUI.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;
using Windows.UI;
using Line = Microsoft.UI.Xaml.Shapes.Line;
using Polyline = Microsoft.UI.Xaml.Shapes.Polyline;
using Polygon = Microsoft.UI.Xaml.Shapes.Polygon;

namespace DeviceStateConsoleAgent.WinUI.Controls;

public sealed partial class MetricLineChart : UserControl
{
    public static readonly DependencyProperty ChartProperty = DependencyProperty.Register(
        nameof(Chart), typeof(ViewerDetailChartViewModel), typeof(MetricLineChart),
        new PropertyMetadata(null, OnChartChanged));

    public static readonly DependencyProperty IsCompactProperty = DependencyProperty.Register(
        nameof(IsCompact), typeof(bool), typeof(MetricLineChart), new PropertyMetadata(false, OnChartChanged));

    public MetricLineChart()
    {
        InitializeComponent();
        Loaded += (_, _) => Draw();
    }

    public ViewerDetailChartViewModel? Chart
    {
        get => (ViewerDetailChartViewModel?)GetValue(ChartProperty);
        set => SetValue(ChartProperty, value);
    }

    public bool IsCompact
    {
        get => (bool)GetValue(IsCompactProperty);
        set
        {
            SetValue(IsCompactProperty, value);
            ApplyCompactLayout();
        }
    }

    private void ApplyCompactLayout()
    {
        if (PlotRow is null) return;
        PlotRow.Height = IsCompact ? new GridLength(56) : new GridLength(210);
        ChartHeader.Visibility = IsCompact ? Visibility.Collapsed : Visibility.Visible;
        ChartFooter.Visibility = IsCompact ? Visibility.Collapsed : Visibility.Visible;
    }

    private static void OnChartChanged(DependencyObject target, DependencyPropertyChangedEventArgs args)
    {
        ((MetricLineChart)target).Draw();
    }

    private void Plot_SizeChanged(object sender, SizeChangedEventArgs e) => Draw();

    private void Draw()
    {
        ApplyCompactLayout();
        Plot.Children.Clear();
        var width = Math.Max(20, Plot.ActualWidth);
        var height = Math.Max(20, Plot.ActualHeight);

        const double left = 2;
        const double top = 8;
        const double bottom = 8;
        var plotWidth = Math.Max(1, width - left * 2);
        var plotHeight = Math.Max(1, height - top - bottom);

        // 1. 100% 绘制标准任务管理器背景暗灰网格 (3 水平线 + 5 垂直线)
        var gridBrush = new SolidColorBrush(Color.FromArgb(42, 255, 255, 255));
        for (var index = 1; index < 5; index++)
        {
            var y = top + plotHeight * index / 5;
            Plot.Children.Add(new Line
            {
                X1 = left, X2 = left + plotWidth, Y1 = y, Y2 = y,
                Stroke = gridBrush, StrokeThickness = 0.75
            });
        }
        for (var index = 1; index < 7; index++)
        {
            var x = left + plotWidth * index / 7;
            Plot.Children.Add(new Line
            {
                X1 = x, X2 = x, Y1 = top, Y2 = top + plotHeight,
                Stroke = gridBrush, StrokeThickness = 0.75
            });
        }

        Plot.Children.Add(new Microsoft.UI.Xaml.Shapes.Rectangle
        {
            Width = plotWidth,
            Height = plotHeight,
            Stroke = new SolidColorBrush(Color.FromArgb(92, 255, 255, 255)),
            StrokeThickness = 1,
            Fill = new SolidColorBrush(Color.FromArgb(0, 0, 0, 0))
        });

        var chart = Chart;
        if (chart is null || chart.Points.Count == 0)
        {
            // 无数据点时展示底层灰色基线
            Plot.Children.Add(new Line
            {
                X1 = left, X2 = left + plotWidth, Y1 = top + plotHeight, Y2 = top + plotHeight,
                Stroke = new SolidColorBrush(Color.FromArgb(80, 255, 255, 255)), StrokeThickness = 1.5
            });
            return;
        }

        if (IsCompact)
        {
            DrawCompact(chart, width, height);
            return;
        }

        var minimum = chart.PlotMinimum;
        var maximum = chart.PlotMaximum;
        if (Math.Abs(maximum - minimum) < 0.0001)
        {
            maximum = minimum + Math.Max(1, Math.Abs(minimum) * 0.1);
            minimum = Math.Max(0, minimum - Math.Max(1, Math.Abs(minimum) * 0.1));
        }

        // 2. 有点时绘制主折线
        var accent = GetSeriesColor(chart.ValueKind);
        var line = new Polyline
        {
            Stroke = new SolidColorBrush(accent),
            StrokeThickness = 2,
            StrokeLineJoin = PenLineJoin.Round
        };
        for (var index = 0; index < chart.Points.Count; index++)
        {
            var point = chart.Points[index];
            var x = left + (chart.Points.Count == 1 ? plotWidth : plotWidth * index / (chart.Points.Count - 1));
            var y = top + plotHeight * (1 - (point.Value - minimum) / (maximum - minimum));
            line.Points.Add(new Point(x, Math.Clamp(y, top, top + plotHeight)));
        }
        Plot.Children.Add(line);

        if (chart.SecondaryPoints.Count > 0)
        {
            var secondaryLine = new Polyline
            {
                Stroke = new SolidColorBrush(GetSecondarySeriesColor(chart.ValueKind)),
                StrokeThickness = 2,
                StrokeLineJoin = PenLineJoin.Round
            };
            for (var index = 0; index < chart.SecondaryPoints.Count; index++)
            {
                var point = chart.SecondaryPoints[index];
                var x = left + (chart.SecondaryPoints.Count == 1 ? plotWidth / 2 : plotWidth * index / (chart.SecondaryPoints.Count - 1));
                var y = top + plotHeight * (1 - (point.Value - minimum) / (maximum - minimum));
                secondaryLine.Points.Add(new Point(x, Math.Clamp(y, top, top + plotHeight)));
            }
            Plot.Children.Add(secondaryLine);
        }
    }

    private void DrawCompact(ViewerDetailChartViewModel chart, double width, double height)
    {
        var accent = GetSeriesColor(chart.ValueKind);
        var left = 2d;
        var right = Math.Max(left + 1, width - 2);
        var top = 4d;
        var bottom = Math.Max(top + 1, height - 4);
        var range = Math.Max(0.0001, chart.PlotMaximum - chart.PlotMinimum);
        var line = new Polyline
        {
            Stroke = new SolidColorBrush(accent),
            StrokeThickness = 1.8,
            StrokeLineJoin = PenLineJoin.Round
        };
        foreach (var (point, index) in chart.Points.Select((point, index) => (point, index)))
        {
            var x = left + (chart.Points.Count == 1 ? (right - left) : (right - left) * index / (chart.Points.Count - 1));
            var y = top + (bottom - top) * (1 - (point.Value - chart.PlotMinimum) / range);
            line.Points.Add(new Point(x, Math.Clamp(y, top, bottom)));
        }
        var area = new Polygon
        {
            Fill = new SolidColorBrush(Color.FromArgb(72, accent.R, accent.G, accent.B)),
            Points = new PointCollection()
        };
        foreach (var point in line.Points)
        {
            area.Points.Add(point);
        }
        area.Points.Add(new Point(right, bottom));
        area.Points.Add(new Point(left, bottom));
        Plot.Children.Add(area);
        Plot.Children.Add(line);
    }

    private static Color GetSeriesColor(ViewerMetricValueKind valueKind) => valueKind switch
    {
        ViewerMetricValueKind.Percent => Color.FromArgb(255, 55, 190, 112),
        ViewerMetricValueKind.Rate => Color.FromArgb(255, 45, 157, 232),
        ViewerMetricValueKind.Megahertz => Color.FromArgb(255, 177, 105, 220),
        ViewerMetricValueKind.Bytes => Color.FromArgb(255, 237, 166, 61),
        ViewerMetricValueKind.Celsius => Color.FromArgb(255, 235, 102, 92),
        ViewerMetricValueKind.Rpm => Color.FromArgb(255, 67, 180, 173),
        _ => (Color)Application.Current.Resources["SystemAccentColor"]
    };

    private static Color GetSecondarySeriesColor(ViewerMetricValueKind valueKind) => valueKind switch
    {
        ViewerMetricValueKind.Rate => Color.FromArgb(255, 244, 176, 64),
        ViewerMetricValueKind.Percent => Color.FromArgb(255, 113, 157, 235),
        _ => Color.FromArgb(255, 235, 176, 75)
    };

    private void Plot_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        var chart = Chart;
        if (chart is null || chart.Points.Count == 0 || Plot.ActualWidth <= 0)
        {
            return;
        }

        var position = e.GetCurrentPoint(Plot).Position;
        var index = (int)Math.Round(Math.Clamp(position.X / Plot.ActualWidth, 0, 1) * (chart.Points.Count - 1));
        var point = chart.Points[index];
        HoverText.Text = $"{chart.FormatHoverValue(index)}\n{point.TimestampText}";
        HoverLabel.Visibility = Visibility.Visible;
        HoverTransform.X = Math.Clamp(position.X + 12, 0, Math.Max(0, Plot.ActualWidth - 155));
        HoverTransform.Y = Math.Clamp(position.Y + 10, 0, Math.Max(0, Plot.ActualHeight - 58));
    }

    private void Plot_PointerExited(object sender, PointerRoutedEventArgs e) => HoverLabel.Visibility = Visibility.Collapsed;
}
