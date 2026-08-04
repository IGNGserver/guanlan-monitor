using DeviceStateConsoleAgent.WinUI.ViewModels;
using Microsoft.UI.Xaml.Controls;

namespace DeviceStateConsoleAgent.WinUI;

public sealed partial class MetricConfigDialog : ContentDialog
{
    private readonly MetricConfigDialogViewModel _model;

    public MetricConfigDialog(MetricConfigDialogViewModel model)
    {
        _model = model;
        InitializeComponent();
        DataContext = model;
    }

    public MetricConfigDialogViewModel Model => _model;
}
