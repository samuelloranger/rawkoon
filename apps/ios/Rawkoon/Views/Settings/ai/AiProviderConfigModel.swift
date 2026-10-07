import Observation
import RawkoonKit
import SwiftUI

/// State behind the AI provider form: `GET/PUT /api/integrations/ai-provider` plus
/// a connection test that reads the *saved* config. Optional API key for hosted providers.
@MainActor @Observable
final class AiProviderConfigModel {
    var loading = true
    var loadError: String?
    var saving = false
    var saveError: String?

    var enabled = false
    var baseURL = ""
    var modelName = ""
    var apiKeyInput = ""
    var hasApiKey = false
    var inputPrice = ""
    var outputPrice = ""
    var budget = ""
    var features = AiFeatureToggles()

    private struct Snapshot: Equatable {
        var enabled: Bool
        var baseURL: String
        var modelName: String
        var inputPrice: String
        var outputPrice: String
        var budget: String
        var features: AiFeatureToggles
    }

    private var loaded: Snapshot?

    private var current: Snapshot {
        Snapshot(
            enabled: enabled, baseURL: baseURL, modelName: modelName,
            inputPrice: inputPrice, outputPrice: outputPrice, budget: budget, features: features.explicit
        )
    }

    var isDirty: Bool {
        current != loaded || !apiKeyInput.isEmpty
    }

    var budgetNeedsPrices: Bool {
        AiUsage.budgetNeedsPrices(
            budget: AiUsage.parsePrice(budget),
            inputPrice: AiUsage.parsePrice(inputPrice),
            outputPrice: AiUsage.parsePrice(outputPrice)
        )
    }

    /// Fills the form from a server payload; also used by the screenshot harness.
    func apply(_ integration: AiProviderIntegrationDTO) {
        enabled = integration.enabled
        baseURL = integration.baseUrl ?? ""
        modelName = integration.model ?? ""
        hasApiKey = integration.hasApiKey ?? false
        inputPrice = AiUsage.priceText(integration.inputPricePerMillion)
        outputPrice = AiUsage.priceText(integration.outputPricePerMillion)
        budget = AiUsage.priceText(integration.dailyBudgetUsd)
        features = (integration.features ?? AiFeatureToggles()).explicit
        apiKeyInput = ""
        loaded = current
        loading = false
        loadError = nil
    }

    func load(api client: APIClient?) async {
        guard let client else { loading = false; return }
        loading = true; loadError = nil
        do {
            try await apply(client.aiProviderIntegration().integration)
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    func save(api client: APIClient?) async {
        guard let client else { return }
        saving = true; saveError = nil
        do {
            try await client.saveAiProviderIntegration(
                SaveAiProviderBody(
                    enabled: enabled, baseUrl: baseURL, model: modelName, apiKey: apiKeyInput,
                    inputPricePerMillion: AiUsage.parsePrice(inputPrice),
                    outputPricePerMillion: AiUsage.parsePrice(outputPrice),
                    dailyBudgetUsd: AiUsage.parsePrice(budget),
                    features: features
                )
            )
            if !apiKeyInput.isEmpty {
                hasApiKey = true
            }
            apiKeyInput = ""
            loaded = current
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }

    func testConnection(api client: APIClient?) async -> TestOutcome {
        guard let client else { return .failure(String(localized: "Not signed in.")) }
        do {
            let result = try await client.testAiProvider()
            if let error = result.error {
                return .failure(error)
            }
            let count = result.models?.count ?? 0
            if result.modelAvailable == false {
                return .success(String(localized: "Connected \u{2014} \(count) models (configured model not found)"))
            }
            return .success(String(localized: "Connected \u{2014} \(count) models"))
        } catch {
            return .failure(settingsErrorMessage(error))
        }
    }
}
