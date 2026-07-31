using DeviceStateConsoleAgent.WinUI.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;
using Windows.UI;
using Line = Microsoft.UI.Xaml.Shapes.Line;
using Polyline = Microsoft.UI.Xaml.Shapes.Polyline;

namespace DeviceStateConsoleAgent.WinUI.Controls;

public sealed partial class MetricLineChart : UserControl
{
    public static readonly DependencyProperty ChartProperty = DependencyProperty.Register(
        nameof(Chart), typeof(ViewerDetailChartViewModel), typeof(MetricLineChart),
        new PropertyMetadata(null, OnChartChanged));

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

    private static void OnChartChanged(DependencyObject target, DependencyPropertyChangedEventArgs args)
    {
        ((MetricLineChart)target).Draw();
    }

    private void Plot_SizeChanged(object sender, SizeChangedEventArgs e) => Draw();

    private void Draw()
    {
        Plot.Children.Clear();
        var width = Math.Max(20, Plot.ActualWidth);
        var height = Math.Max(20, Plot.ActualHeight);

        const double left = 2;
        const double top = 8;
        const double bottom = 8;
        var plotWidth = Math.Max(1, width - left * 2);
        var plotHeight = Math.Max(1, height - top - bottom);

        // 1. 100% 绘制标准任务管理器背景暗灰网格 (3 水平线 + 5 垂直线)
        var gridBrush = new SolidColorBrush(Color.FromArgb(35, 255, 255, 255));
        for (var index = 1; index < 4; index++)
        {
            var y = top + plotHeight * index / 4;
            Plot.Children.Add(new Line
            {
                X1 = left, X2 = left + plotWidth, Y1 = y, Y2 = y,
                Stroke = gridBrush, StrokeThickness = 1
            });
        }
        for (var index = 1; index < 6; index++)
        {
            var x = left + plotWidth * index / 6;
            Plot.Children.Add(new Line
            {
                X1 = x, X2 = x, Y1 = top, Y2 = top + plotHeight,
                Stroke = gridBrush, StrokeThickness = 1
            });
        }

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

        var minimum = chart.PlotMinimum;
        var maximum = chart.PlotMaximum;
        if (Math.Abs(maximum - minimum) < 0.0001)
        {
            maximum = minimum + Math.Max(1, Math.Abs(minimum) * 0.1);
            minimum = Math.Max(0, minimum - Math.Max(1, Math.Abs(minimum) * 0.1));
        }

        // 2. 有点时绘制主折线
        var accent = (Color)Application.Current.Resources["SystemAccentColor"];
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
                Stroke = new SolidColorBrush(Color.FromArgb(175, accent.R, accent.G, accent.B)),
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
