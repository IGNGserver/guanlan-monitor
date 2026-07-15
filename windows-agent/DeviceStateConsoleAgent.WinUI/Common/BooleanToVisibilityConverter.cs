using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Data;

namespace DeviceStateConsoleAgent.WinUI.Common;

public sealed class BooleanToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, string language)
    {
        var visible = value is bool boolValue && boolValue;
        return visible ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object value, Type targetType, object parameter, string language)
    {
        return value is Visibility visibility && visibility == Visibility.Visible;
    }
}
