import { useState, useEffect, useCallback } from "react";
import { Form, Modal, message } from "@agentscope-ai/design";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import type {
  AgentsRunningConfig,
  MemoryManagerConfig,
} from "../../../api/types";
import { useAgentStore } from "../../../stores/agentStore";

/**
 * Custom hook that manages the Agent Config page state.
 *
 * Fetches running config, memory manager config, language, and timezone
 * on mount (and whenever the selected agent changes).  On save, it
 * splits the form values into two payloads:
 *   1. `AgentsRunningConfig` – sent to PUT /agent/running-config
 *   2. `MemoryManagerConfig` – sent to PUT /agent/memory-manager-config
 */
export function useAgentConfig() {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("zh");
  const [savingLang, setSavingLang] = useState(false);
  const [timezone, setTimezone] = useState<string>("UTC");
  const [savingTimezone, setSavingTimezone] = useState(false);
  const { selectedAgent } = useAgentStore();

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [config, langResp, tzResp] = await Promise.all([
        api.getAgentRunningConfig(),
        api.getAgentLanguage(),
        api.getUserTimezone(),
      ]);
      form.setFieldsValue(config);
      // Load memory manager config and flatten into form.
      // The backend and adbpg fields are stored separately from
      // AgentsRunningConfig so they need their own API call.
      try {
        const mmConfig = await api.getMemoryManagerConfig();
        form.setFieldsValue({
          memory_backend: mmConfig.backend || "local",
          adbpg: mmConfig.adbpg,
          strip_local_memory_instructions:
            mmConfig.strip_local_memory_instructions || false,
        });
      } catch {
        // Memory manager config may not exist yet, use defaults
        form.setFieldsValue({ memory_backend: "local" });
      }
      setLanguage(langResp.language);
      setTimezone(tzResp.timezone || "UTC");
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : t("agentConfig.loadFailed");
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  }, [form, t]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig, selectedAgent]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      // Separate memory manager fields from running config fields.
      // Form stores them flat; we split before sending to two endpoints.
      const {
        memory_backend,
        adbpg,
        strip_local_memory_instructions,
        ...runningValues
      } = values;

      // Save running config
      await api.updateAgentRunningConfig(runningValues as AgentsRunningConfig);

      // Save memory manager config
      const mmConfig: MemoryManagerConfig = {
        backend: memory_backend || "local",
        adbpg: adbpg || {
          host: "",
          port: 5432,
          user: "",
          password: "",
          dbname: "",
          llm_model: "",
          llm_api_key: "",
          llm_base_url: "",
          embedding_model: "",
          embedding_api_key: "",
          embedding_base_url: "",
          embedding_dims: 1024,
          hnsw: null,
          search_timeout: 10.0,
          pool_minconn: 2,
          pool_maxconn: 10,
          tool_compact_mode: "summarize",
          tool_compact_max_len: 500,
          memory_isolation: false,
          api_mode: "sql",
          rest_api_key: "",
          rest_base_url: "https://api.mem0.ai",
        },
        strip_local_memory_instructions:
          strip_local_memory_instructions || false,
      };
      await api.updateMemoryManagerConfig(mmConfig);

      message.success(t("agentConfig.saveSuccess"));
    } catch (err) {
      if (err instanceof Error && "errorFields" in err) return;
      const errMsg =
        err instanceof Error ? err.message : t("agentConfig.saveFailed");
      message.error(errMsg);
    } finally {
      setSaving(false);
    }
  }, [form, t]);

  const handleLanguageChange = useCallback(
    (value: string): void => {
      if (value === language) return;
      Modal.confirm({
        title: t("agentConfig.languageConfirmTitle"),
        content: (
          <span style={{ whiteSpace: "pre-line" }}>
            {t("agentConfig.languageConfirmContent")}
          </span>
        ),
        okText: t("agentConfig.languageConfirmOk"),
        cancelText: t("common.cancel"),
        onOk: async () => {
          setSavingLang(true);
          try {
            const resp = await api.updateAgentLanguage(value);
            setLanguage(resp.language);
            if (resp.copied_files && resp.copied_files.length > 0) {
              message.success(
                t("agentConfig.languageSaveSuccessWithFiles", {
                  count: resp.copied_files.length,
                }),
              );
            } else {
              message.success(t("agentConfig.languageSaveSuccess"));
            }
          } catch (err) {
            const errMsg =
              err instanceof Error
                ? err.message
                : t("agentConfig.languageSaveFailed");
            message.error(errMsg);
          } finally {
            setSavingLang(false);
          }
        },
      });
    },
    [language, t],
  );

  const handleTimezoneChange = useCallback(
    async (value: string) => {
      if (value === timezone) return;
      setSavingTimezone(true);
      try {
        await api.updateUserTimezone(value);
        setTimezone(value);
        message.success(t("agentConfig.timezoneSaveSuccess"));
      } catch (err) {
        const errMsg =
          err instanceof Error
            ? err.message
            : t("agentConfig.timezoneSaveFailed");
        message.error(errMsg);
      } finally {
        setSavingTimezone(false);
      }
    },
    [timezone, t],
  );

  return {
    form,
    loading,
    saving,
    error,
    language,
    savingLang,
    timezone,
    savingTimezone,
    fetchConfig,
    handleSave,
    handleLanguageChange,
    handleTimezoneChange,
  };
}
