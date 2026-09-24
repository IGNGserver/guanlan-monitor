using System.Collections.ObjectModel;
using DeviceStateConsoleAgent.WinUI.Common;

namespace DeviceStateConsoleAgent.WinUI.ViewModels;

public sealed class MetricConfigDialogViewModel : ObservableObject
{
    public MetricConfigDialogViewModel(
        string title,
        string subtitle,
        string instruction,
        IEnumerable<MetricConfigOptionViewModel> options)
    {
        Title = title;
        Subtitle = subtitle;
        Instruction = instruction;
        Options = new ObservableCollection<MetricConfigOptionViewModel>(options);
        foreach (var option in Options)
        {
            option.PropertyChanged += Option_PropertyChanged;
        }
    }

    public string Title { get; }
    public string Subtitle { get; }
    public string Instruction { get; }
    public ObservableCollection<MetricConfigOptionViewModel> Options { get; }

    public string Summary => Options.Count == 0
        ? "当前类别没有可配置字段。"
        : $"已选择 {Options.Count(option => option.IsEnabled)} / {Options.Count} 个字段。保存后才会写入本机上报配置。";

    private void Option_PropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MetricConfigOptionViewModel.IsEnabled))
        {
            OnPropertyChanged(nameof(Summary));
        }
    }
}

public sealed class MetricConfigOptionViewModel : ObservableObject
{
    private bool _isEnabled;

    public MetricConfigOptionViewModel(string key, string label, string description, bool isEnabled)
    {
        Key = key;
        Label = label;
        Description = description;
        _isEnabled = isEnabled;
    }

    public string Key { get; }
    public string Label { get; }
    public string Description { get; }

    public bool IsEnabled
    {
        get => _isEnabled;
        set => SetProperty(ref _isEnabled, value);
    }
}
