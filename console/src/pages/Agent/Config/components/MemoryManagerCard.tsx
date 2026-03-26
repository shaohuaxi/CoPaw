import { useState } from "react";
import {
  Card,
  Form,
  Select,
  Input,
  InputNumber,
  Button,
  Switch,
} from "@agentscope-ai/design";
import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import { agentApi } from "../../../../api/modules/agent";
import styles from "../index.module.less";

export function MemoryManagerCard() {
  const { t } = useTranslation();
  const form = Form.useFormInstance();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    type: "success" | "error" | "warning";
    message: string;
  } | null>(null);
  // Reactively watch the selected backend to conditionally render ADBPG fields
  const backend = Form.useWatch("memory_manager_backend") ?? "remelight";
  const apiMode = Form.useWatch(["adbpg", "api_mode"]) ?? "sql";

  const handleTestConnection = async () => {
    setTestResult(null);
    const adbpg = form.getFieldValue("adbpg") || {};
    const host = adbpg.host || "";
    const port = adbpg.port || 5432;
    const user = adbpg.user || "";
    const password = adbpg.password || "";
    const dbname = adbpg.dbname || "";
    if (!host || !user || !password || !dbname) {
      setTestResult({
        type: "warning",
        message: t("agentConfig.memoryManager.testConnectionFillRequired"),
      });
      return;
    }
    setTesting(true);
    try {
      const res = await agentApi.testAdbpgConnection({
        host,
        port,
        user,
        password,
        dbname,
      });
      if (res.success) {
        setTestResult({ type: "success", message: res.message });
      } else {
        setTestResult({ type: "error", message: res.message });
      }
    } catch (err) {
      console.error("Test connection error:", err);
      setTestResult({
        type: "error",
        message: t("agentConfig.memoryManager.testConnectionError"),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      className={styles.formCard}
      title={t("agentConfig.memoryManager.title")}
      style={{ marginTop: 16 }}
    >
      <Form.Item
        label={t("agentConfig.memoryManager.backendLabel")}
        name="memory_manager_backend"
        rules={[{ required: true }]}
        tooltip={t("agentConfig.memoryManager.backendTooltip")}
      >
        <Select>
          <Select.Option value="remelight">
            Memory Manager (ReMeLight)
          </Select.Option>
          <Select.Option value="adbpg">Memory Manager (ADBPG)</Select.Option>
        </Select>
      </Form.Item>

      {backend === "adbpg" && (
        <>
          {/* API mode selector */}
          <Form.Item
            label={t("agentConfig.memoryManager.apiModeLabel")}
            name={["adbpg", "api_mode"]}
            tooltip={t("agentConfig.memoryManager.apiModeTooltip")}
            initialValue="sql"
          >
            <Select>
              <Select.Option value="sql">SQL</Select.Option>
              <Select.Option value="rest">REST</Select.Option>
            </Select>
          </Form.Item>

          {apiMode === "rest" && (
            <Card
              type="inner"
              title={t("agentConfig.memoryManager.restConnectionTitle")}
              style={{ marginBottom: 16 }}
            >
              <Form.Item
                label={t("agentConfig.memoryManager.restApiKey")}
                name={["adbpg", "rest_api_key"]}
                rules={[
                  {
                    required: true,
                    message: t("agentConfig.memoryManager.restApiKeyRequired"),
                  },
                ]}
              >
                <Input.Password
                  placeholder={t(
                    "agentConfig.memoryManager.restApiKeyPlaceholder",
                  )}
                />
              </Form.Item>
              <Form.Item
                label={t("agentConfig.memoryManager.restBaseUrl")}
                name={["adbpg", "rest_base_url"]}
                tooltip={t("agentConfig.memoryManager.restBaseUrlTooltip")}
              >
                <Input placeholder="https://api.mem0.ai" />
              </Form.Item>
            </Card>
          )}

          {/* --- SQL-specific fields (shown only when api_mode !== "rest") --- */}
          {apiMode !== "rest" && (
            <>
              {/* Database connection parameters */}
              <Card
                type="inner"
                title={t("agentConfig.memoryManager.dbConnectionTitle")}
                style={{ marginBottom: 16 }}
              >
                <Form.Item
                  label={t("agentConfig.memoryManager.host")}
                  name={["adbpg", "host"]}
                  rules={[
                    {
                      required: true,
                      message: t("agentConfig.memoryManager.hostRequired"),
                    },
                  ]}
                >
                  <Input placeholder="e.g. gp-xxx.gpdb.rds.aliyuncs.com" />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.port")}
                  name={["adbpg", "port"]}
                  rules={[{ required: true }]}
                  initialValue={5432}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={1}
                    max={65535}
                    placeholder="5432"
                  />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.user")}
                  name={["adbpg", "user"]}
                  rules={[
                    {
                      required: true,
                      message: t("agentConfig.memoryManager.userRequired"),
                    },
                  ]}
                >
                  <Input
                    placeholder={t("agentConfig.memoryManager.userPlaceholder")}
                  />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.password")}
                  name={["adbpg", "password"]}
                  rules={[
                    {
                      required: true,
                      message: t("agentConfig.memoryManager.passwordRequired"),
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={t(
                      "agentConfig.memoryManager.passwordPlaceholder",
                    )}
                  />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.dbname")}
                  name={["adbpg", "dbname"]}
                  rules={[
                    {
                      required: true,
                      message: t("agentConfig.memoryManager.dbnameRequired"),
                    },
                  ]}
                >
                  <Input
                    placeholder={t(
                      "agentConfig.memoryManager.dbnamePlaceholder",
                    )}
                  />
                </Form.Item>
                <Form.Item>
                  <Button
                    type="default"
                    loading={testing}
                    onClick={handleTestConnection}
                  >
                    {t("agentConfig.memoryManager.testConnection")}
                  </Button>
                  {testResult && (
                    <Alert
                      style={{ marginTop: 8 }}
                      type={testResult.type}
                      message={testResult.message}
                      showIcon
                      closable
                      onClose={() => setTestResult(null)}
                    />
                  )}
                </Form.Item>
              </Card>

              {/* LLM configuration for adbpg_llm_memory.config() */}
              <Card
                type="inner"
                title={t("agentConfig.memoryManager.llmConfigTitle")}
                style={{ marginBottom: 16 }}
              >
                <Form.Item
                  label={t("agentConfig.memoryManager.llmModel")}
                  name={["adbpg", "llm_model"]}
                  rules={[
                    {
                      required: true,
                      message: t("agentConfig.memoryManager.llmModelRequired"),
                    },
                  ]}
                >
                  <Input placeholder="e.g. qwen-plus" />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.llmApiKey")}
                  name={["adbpg", "llm_api_key"]}
                  rules={[
                    {
                      required: true,
                      message: t("agentConfig.memoryManager.llmApiKeyRequired"),
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={t(
                      "agentConfig.memoryManager.llmApiKeyPlaceholder",
                    )}
                  />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.llmBaseUrl")}
                  name={["adbpg", "llm_base_url"]}
                  rules={[
                    {
                      required: true,
                      message: t(
                        "agentConfig.memoryManager.llmBaseUrlRequired",
                      ),
                    },
                  ]}
                >
                  <Input placeholder="e.g. https://dashscope.aliyuncs.com/compatible-mode/v1" />
                </Form.Item>
              </Card>

              {/* Embedding model configuration for vector search */}
              <Card
                type="inner"
                title={t("agentConfig.memoryManager.embeddingConfigTitle")}
                style={{ marginBottom: 16 }}
              >
                <Form.Item
                  label={t("agentConfig.memoryManager.embeddingModel")}
                  name={["adbpg", "embedding_model"]}
                  tooltip={t("agentConfig.memoryManager.embeddingModelTooltip")}
                  initialValue="text-embedding-v3"
                >
                  <Input placeholder="text-embedding-v3" />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.embeddingApiKey")}
                  name={["adbpg", "embedding_api_key"]}
                  rules={[
                    {
                      required: true,
                      message: t(
                        "agentConfig.memoryManager.embeddingApiKeyRequired",
                      ),
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={t(
                      "agentConfig.memoryManager.embeddingApiKeyPlaceholder",
                    )}
                  />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.embeddingBaseUrl")}
                  name={["adbpg", "embedding_base_url"]}
                  rules={[
                    {
                      required: true,
                      message: t(
                        "agentConfig.memoryManager.embeddingBaseUrlRequired",
                      ),
                    },
                  ]}
                >
                  <Input placeholder="e.g. https://dashscope.aliyuncs.com/compatible-mode/v1" />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.embeddingDims")}
                  name={["adbpg", "embedding_dims"]}
                  tooltip={t("agentConfig.memoryManager.embeddingDimsTooltip")}
                  initialValue={1024}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={1}
                    placeholder="1024"
                  />
                </Form.Item>
              </Card>
            </>
          )}

          {/* Optional tuning: HNSW index, search timeout */}
          <Card
            type="inner"
            title={t("agentConfig.memoryManager.optionalConfigTitle")}
          >
            {apiMode !== "rest" && (
              <>
                <Form.Item
                  label={t("agentConfig.memoryManager.hnsw")}
                  name={["adbpg", "hnsw"]}
                  tooltip={t("agentConfig.memoryManager.hnswTooltip")}
                >
                  <Input
                    placeholder={t(
                      "agentConfig.memoryManager.optionalPlaceholder",
                    )}
                  />
                </Form.Item>
              </>
            )}
            <Form.Item
              label={t("agentConfig.memoryManager.searchTimeout")}
              name={["adbpg", "search_timeout"]}
              tooltip={t("agentConfig.memoryManager.searchTimeoutTooltip")}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0.1}
                step={0.5}
                placeholder="10.0"
              />
            </Form.Item>
            {apiMode !== "rest" && (
              <>
                <Form.Item
                  label={t("agentConfig.memoryManager.poolMinconn")}
                  name={["adbpg", "pool_minconn"]}
                  tooltip={t("agentConfig.memoryManager.poolMinconnTooltip")}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={1}
                    max={100}
                    placeholder="2"
                  />
                </Form.Item>
                <Form.Item
                  label={t("agentConfig.memoryManager.poolMaxconn")}
                  name={["adbpg", "pool_maxconn"]}
                  tooltip={t("agentConfig.memoryManager.poolMaxconnTooltip")}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={1}
                    max={200}
                    placeholder="10"
                  />
                </Form.Item>
              </>
            )}
            <Form.Item
              label={t("agentConfig.memoryManager.toolCompactMode")}
              name={["adbpg", "tool_compact_mode"]}
              tooltip={t("agentConfig.memoryManager.toolCompactModeTooltip")}
            >
              <Select>
                <Select.Option value="summarize">summarize</Select.Option>
                <Select.Option value="truncate">truncate</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item
              label={t("agentConfig.memoryManager.toolCompactMaxLen")}
              name={["adbpg", "tool_compact_max_len"]}
              tooltip={t("agentConfig.memoryManager.toolCompactMaxLenTooltip")}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={100}
                step={100}
                placeholder="500"
              />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.memoryManager.memoryIsolation")}
              name={["adbpg", "memory_isolation"]}
              valuePropName="checked"
              tooltip={t("agentConfig.memoryManager.memoryIsolationTooltip")}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label={t("agentConfig.memoryManager.stripLocalMemory")}
              name="strip_local_memory_instructions"
              valuePropName="checked"
              tooltip={t("agentConfig.memoryManager.stripLocalMemoryTooltip")}
            >
              <Switch />
            </Form.Item>
          </Card>
        </>
      )}
    </Card>
  );
}
