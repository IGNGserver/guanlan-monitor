import SwiftUI

public struct AppRootView: View {
    @State private var viewModel = AppViewModel()
    
    public init() {}
    
    public var body: some View {
        Group {
            switch viewModel.activeScreen {
            case .login:
                LoginView(viewModel: viewModel)
            case .deviceList:
                DeviceListView(viewModel: viewModel)
            case .deviceDetail(let deviceId):
                DeviceDetailView(viewModel: viewModel, deviceId: deviceId)
            case .traffic(let deviceId):
                DeviceDetailView(viewModel: viewModel, deviceId: deviceId)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: viewModel.activeScreen)
    }
}
