import SwiftUI

/// The provider form as Form sections: connection, prices, budget, per-feature
/// switches and the connection test. Loading and saving live in the owner.
struct AiProviderConfigSections: View {
    @Bindable var config: AiProviderConfigModel
    let api: () -> APIClient?

    var body: some View {
        Section {
            ToggleRow("Enabled", isOn: $config.enabled)
            LabeledTextFieldRow(
                title: "Base URL", text: $config.baseURL,
                placeholder: "http://localhost:8080", keyboard: .URL
            )
            LabeledTextFieldRow(title: "Model", text: $config.modelName, placeholder: "model name")
            SecretFieldRow(title: "API key", input: $config.apiKeyInput, isStored: config.hasApiKey)
        } footer: {
            Text("OpenAI-compatible model that picks releases, local (llama.cpp, Ollama) or hosted (Groq). Leave the API key blank for a local server.")
        }
        Section {
            LabeledTextFieldRow(
                title: "Input price (USD per million tokens)", text: $config.inputPrice,
                placeholder: "0.00", keyboard: .decimalPad
            )
            .id("ai-prices")
            LabeledTextFieldRow(
                title: "Output price (USD per million tokens)", text: $config.outputPrice,
                placeholder: "0.00", keyboard: .decimalPad
            )
        } footer: {
            Text("Used to estimate cost. Find your model's price on your provider's pricing page.")
        }
        Section {
            LabeledTextFieldRow(
                title: "Daily budget (USD)", text: $config.budget,
                placeholder: "No budget", keyboard: .decimalPad
            )
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text("When today's estimated spend reaches this, automatic grabs fall back to the classic scorer until midnight UTC. Needs prices.")
                if config.budgetNeedsPrices {
                    Label("A budget only applies once at least one price is set.", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Theme.apricot)
                }
            }
        }
        Section {
            ForEach(AiFeature.allCases) { feature in
                ToggleRow(feature.toggleTitle, isOn: featureBinding(feature))
            }
        } header: {
            Text("Features")
        } footer: {
            Text("Turn off the places where AI is allowed to pick. Disabled ones use the classic scorer.")
        }
        Section {
            TestConnectionButton {
                await config.testConnection(api: api())
            }
        } footer: {
            Text("Tests the saved configuration.")
        }
        if let saveError = config.saveError {
            Section { Text(saveError).foregroundStyle(Theme.terracotta) }
                .listRowBackground(Theme.raised)
        }
    }

    private func featureBinding(_ feature: AiFeature) -> Binding<Bool> {
        Binding(
            get: { config.features.isOn(feature) },
            set: { config.features.set(feature, on: $0) }
        )
    }
}
