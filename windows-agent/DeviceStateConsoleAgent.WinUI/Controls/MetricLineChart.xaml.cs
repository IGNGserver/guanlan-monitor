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
    }

    public ViewerDetailChartViewModel? Chart
    {
        get => (ViewerDetailChartViewModel?)GetValue(ChartProperty);
        set => SetValue(ChartProperty, value);
    }

    private static void OnChartChanged(DependencyObject target, DependencyPropertyChangedEventArgs args)
        => ((MetricLineChart)target).Draw();

    private void Plot_SizeChanged(object sender, SizeChangedEventArgs e) => Draw();

    private void Draw()
    {
        Plot.Children.Clear();
        var chart = Chart;
        if (chart is null || Plot.ActualWidth < 12 || Plot.ActualHeight < 12 || chart.Points.Count == 0)
        {
            return;
        }

        const double left = 2;
        const double top = 8;
        const double bottom = 8;
        var width = Math.Max(1, Plot.ActualWidth - left * 2);
        var height = Math.Max(1, Plot.ActualHeight - top - bottom);
        var minimum = chart.PlotMinimum;
        var maximum = chart.PlotMaximum;
        if (Math.Abs(maximum - minimum) < 0.0001)
        {
            maximum = minimum + Math.Max(1, Math.Abs(minimum) * 0.1);
            minimum = Math.Max(0, minimum - Math.Max(1, Math.Abs(minimum) * 0.1));
        }

        for (var index = 1; index < 4; index++)
        {
            var y = top + height * index / 4;
            Plot.Children.Add(new Line
            {
                X1 = left, X2 = left + width, Y1 = y, Y2 = y,
                Stroke = new SolidColorBrush(Color.FromArgb(60, 127, 127, 127)), StrokeThickness = 1
            });
        }

        var line = new Polyline
        {
            Stroke = new SolidColorBrush(Color.FromArgb(255, 74, 190, 238)),
            StrokeThickness = 2,
            StrokeLineJoin = PenLineJoin.Round
        };
        for (var index = 0; index < chart.Points.Count; index++)
        {
            var point = chart.Points[index];
            var x = left + (chart.Points.Count == 1 ? width : width * index / (chart.Points.Count - 1));
            var y = top + height * (1 - (point.Value - minimum) / (maximum - minimum));
            line.Points.Add(new Point(x, Math.Clamp(y, top, top + height)));
        }
        Plot.Children.Add(line);
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
        HoverText.Text = $"{chart.FormatValue(point.Value)}\n{point.TimestampText}";
        HoverLabel.Visibility = Visibility.Visible;
        HoverTransform.X = Math.Clamp(position.X + 12, 0, Math.Max(0, Plot.ActualWidth - 155));
        HoverTransform.Y = Math.Clamp(position.Y + 10, 0, Math.Max(0, Plot.ActualHeight - 58));
    }

    private void Plot_PointerExited(object sender, PointerRoutedEventArgs e) => HoverLabel.Visibility = Visibility.Collapsed;
}
