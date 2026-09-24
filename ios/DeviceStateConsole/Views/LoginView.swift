import SwiftUI

public struct LoginView: View {
    @Bindable var viewModel: AppViewModel
    
    @State private var baseUrlInput: String = ""
    @State private var accessKeyInput: String = ""
    
    public init(viewModel: AppViewModel) {
        self.viewModel = viewModel
        _baseUrlInput = State(initialValue: viewModel.serverConfig.baseUrl)
        _accessKeyInput = State(initialValue: viewModel.serverConfig.accessKey)
    }
    
    public var body: some View {
        VStack(spacing: 24) {
            Spacer()
            
            // App Logo & Title
            VStack(spacing: 12) {
                Image(systemName: "desktopcomputer")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 64, height: 64)
                    .foregroundStyle(.tint)
                    .padding()
                    .background(.thinMaterial)
                    .clipShape(Circle())
                    .shadow(radius: 4)
                
                Text("设备状态控制台")
                    .font(.title2)
                    .fontWeight(.bold)
                
                Text("配置服务器连接并进行监控")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            
            // Form Cards
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("服务器地址 (Base URL)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    TextField("http://192.168.1.100:3100", text: $baseUrlInput)
                        .textFieldStyle(.roundedBorder)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .keyboardType(.URL)
                }
                
                VStack(alignment: .leading, spacing: 6) {
                    Text("访问密钥 (Access Key)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    SecureField("输入密钥 (选填)", text: $accessKeyInput)
                        .textFieldStyle(.roundedBorder)
                }
            }
            .padding()
            .background(Color(uiColor: .secondarySystemGroupedBackground))
            .cornerRadius(16)
            .padding(.horizontal)
            
            if let error = viewModel.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            
            // Connect Button
            Button {
                viewModel.serverConfig.baseUrl = baseUrlInput
                viewModel.serverConfig.accessKey = accessKeyInput
                Task {
                    await viewModel.login()
                }
            } label: {
                HStack {
                    if viewModel.isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text("连接并登录")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .cornerRadius(12)
            }
            .disabled(viewModel.isLoading)
            .padding(.horizontal)
            
            Spacer()
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .onAppear {
            baseUrlInput = viewModel.serverConfig.baseUrl
            accessKeyInput = viewModel.serverConfig.accessKey
        }
    }
}
