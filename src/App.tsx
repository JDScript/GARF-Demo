import {
  Button,
  Upload,
  App as AntdApp,
  Splitter,
  InputNumber,
  Form,
  Switch,
  Descriptions,
  Segmented,
  Alert,
  Typography,
  Spin,
  Input,
} from "antd";
import { CloudUploadOutlined, ToolOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { AssembleSettings, AssembleStatus, AssembleTask } from "./AssembleTask";
import { useGradioClient } from "./context";
import AssemblyScene from "./components/assembly-scene";
import { useResponsive, useSessionStorageState } from "ahooks";
import Gallery from "./components/gallery";

const ASSEMBLE_STATUS_MESSAGE_KEY = "ASSEMBLE_STATUS_MESSAGE";

const App = () => {
  const gradioClient = useGradioClient();
  const [assembleTask, setAssembleTask] = useState<AssembleTask>();
  const { message, modal } = AntdApp.useApp();
  const [meshFileList, setMeshFileList] = useState<File[]>([]);
  const [assembling, setAssembling] = useState(false);
  const [assembleSettings, setAssembleSettings] = useState<AssembleSettings>({
    samplePoints: 5000,
    steps: 20,
    seed: 42,
    maxIterations: 1,
    oneStepInit: false,
    sampleStrategy: "poisson",
    loraCheckpoint: "",
    ckpt: "",
    dataCollection: true,
  });
  const { md } = useResponsive();
  const [visualizationSettings, setVisualizationSettings] = useState({
    showMesh: true,
    showPointCloud: false,
    showFractureSurface: false,
    fractureSurfaceOffset: 0.5,
    showTrail: false,
  });
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [allowCollection, setAllowCollection] = useSessionStorageState(
    "allowCollection",
    {
      defaultValue: true,
      deserializer: (value) => {
        if (value === "false") {
          return false;
        }
        return true;
      },
      serializer: (value) => {
        if (value === false) {
          return "false";
        }
        return "true";
      },
    }
  );

  useEffect(() => {
    if (window.sessionStorage.getItem("allowCollection") === null) {
      modal.confirm({
        title: "Data Collection Notice",
        content: (
          <div className="flex flex-col gap-2">
            <p>Thank you for trying out our demo!</p>
            <p>
              With your permission, we would like to collect the data you upload
              (e.g., <b>fragments or inputs</b>) to support our research.
            </p>
            <p>
              Your data will be used <b>solely for academic purposes</b> and
              handled with strict confidentiality. We will{" "}
              <b>not make your data publicly available</b>.
            </p>
            <p>
              If you prefer not to share your data, you can opt out — the demo
              will still work as expected.
            </p>
          </div>
        ),
        cancelText: "Decline",
        okText: "Agree to share",
        onCancel: () => {
          setAllowCollection(false);
        },
        onOk: () => {
          setAllowCollection(true);
        },
        closable: false,
      });
    }
  }, [modal, setAllowCollection]);

  useEffect(() => {
    if (meshFileList.length) {
      try {
        setAssembleTask(new AssembleTask(gradioClient, meshFileList));
      } catch (error) {
        if (error instanceof Error) {
          message.error(error.message);
        }
      }
    }
  }, [meshFileList, gradioClient, message]);

  useEffect(() => {
    const onAssembleStatusUpdate = (
      status: AssembleStatus,
      step?: number,
      totalSteps?: number
    ) => {
      switch (status) {
        case AssembleStatus.REQUESTED: {
          message.open({
            key: ASSEMBLE_STATUS_MESSAGE_KEY,
            type: "loading",
            content: "Waiting for mesh files to be uploaded",
            duration: -1,
          });
          break;
        }
        case AssembleStatus.QUEUED: {
          message.open({
            key: ASSEMBLE_STATUS_MESSAGE_KEY,
            type: "loading",
            content: "Assemble task queued",
            duration: -1,
          });
          break;
        }
        case AssembleStatus.PROGRESSING: {
          message.open({
            key: ASSEMBLE_STATUS_MESSAGE_KEY,
            type: "loading",
            content: `Assembling... ${step}/${totalSteps}`,
            duration: -1,
          });
          break;
        }
        case AssembleStatus.COMPLETED: {
          message.open({
            key: ASSEMBLE_STATUS_MESSAGE_KEY,
            type: "success",
            content: "Assemble task completed",
            duration: 3,
          });
          setAssembling(false);
          break;
        }
        case AssembleStatus.FAILED: {
          message.open({
            key: ASSEMBLE_STATUS_MESSAGE_KEY,
            type: "error",
            content: "Assemble task failed",
            duration: 3,
          });
          setAssembling(false);
          break;
        }
      }
    };

    const showMetrics = (metrics: { [key: string]: number }) => {
      modal.info({
        title: "Metrics",
        content: (
          <div>
            If your input is already aligned, the following metrics can be used
            to evaluate the quality of the assembly:
            <Descriptions
              bordered
              style={{ marginTop: 8 }}
              size="small"
              column={1}
              items={Object.keys(metrics).map((key) => ({
                label: <span dangerouslySetInnerHTML={{ __html: key }} />,
                children: metrics[key].toFixed(4),
              }))}
            />
          </div>
        ),
      });
    };

    assembleTask?.on("statusUpdate", onAssembleStatusUpdate);
    assembleTask?.on("recvMetrics", showMetrics);
    return () => {
      assembleTask?.off("statusUpdate", onAssembleStatusUpdate);
      assembleTask?.off("recvMetrics", showMetrics);
    };
  }, [assembleTask, message, modal]);

  const [downloadingObjProgress, setDownloadingObjProgress] = useState<
    | {
        downloadedBytes: number;
        totalBytes: number;
      }
    | undefined
  >(undefined);
  const assembleFromGallery = async (
    baseUrl: string,
    folder: string,
    files: string[]
  ) => {
    setDownloadingObjProgress({ downloadedBytes: 0, totalBytes: -1 });
    setGalleryVisible(false);

    try {
      let downloadedBytes = 0;
      let totalBytes = 0;

      // 计算总文件大小（可选）
      const fileSizes = await Promise.all(
        files.map(async (f) => {
          const headRes = await fetch(`${baseUrl}/${folder}/${f}`, {
            method: "HEAD",
          });
          if (headRes.ok) {
            return Number(headRes.headers.get("Content-Length")) || 0;
          }
          return 0;
        })
      );

      totalBytes = fileSizes.reduce((a, b) => a + b, 0) || 1; // 避免除以 0

      const updateProgress = (bytes: number) => {
        downloadedBytes += bytes;
        setDownloadingObjProgress({
          downloadedBytes,
          totalBytes,
        });
      };

      const downloadFile = async (fileName: string) => {
        const res = await fetch(`${baseUrl}/${folder}/${fileName}`, {
          cache: "force-cache",
        });
        if (!res.ok || !res.body)
          throw new Error(`Failed to download ${fileName}`);

        const reader = res.body.getReader();
        const chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          updateProgress(value.length);
        }

        const blob = new Blob(chunks);
        return new File([blob], fileName, { type: blob.type });
      };

      const meshes = await Promise.all(files.map(downloadFile));

      setAssembleTask(
        new AssembleTask(
          gradioClient,
          meshes,
          files.map((f) => `gallery/${folder}/${f}`)
        )
      );
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message);
      }
    } finally {
      setDownloadingObjProgress(undefined);
    }
  };

  // const {
  //   data: loraOptions = [{ value: "", label: "None" }],
  //   loading: loadingLoRA,
  // } = useRequest(
  //   async () => {
  //     return [
  //       { value: "", label: "None" },
  //       ...(
  //         (await gradioClient.predict("get_available_lora", [])).data as {
  //           label: string;
  //           value: string;
  //         }[][]
  //       )[0],
  //     ];
  //   },
  //   {
  //     refreshDeps: [gradioClient],
  //   }
  // );

  // const {
  //   data: checkpointOptions = [{ value: "", label: "None" }],
  //   loading: loadingCheckpoint,
  // } = useRequest(
  //   async () => {
  //     return [
  //       { value: "", label: "None" },
  //       ...(
  //         (await gradioClient.predict("get_available_ckpt", [])).data as {
  //           label: string;
  //           value: string;
  //         }[][]
  //       )[0],
  //     ];
  //   },
  //   {
  //     refreshDeps: [gradioClient],
  //   }
  // );

  const [expName, setExpName] = useState("result");

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Alert
        type="info"
        message={
          <span>
            Don't know where to start? Check out samples in our{" "}
            <Typography.Link
              onClick={() => {
                setGalleryVisible(true);
              }}
            >
              gallery
            </Typography.Link>
            !
          </span>
        }
        banner
      />
      <div className="h-12 bg-gray-100 items-center flex shrink-0 px-4 justify-between flex-nowrap">
        <span className="font-bold text-xl overflow-hidden text-nowrap text-ellipsis flex items-center">
          <img
            src="/garf.png"
            style={{
              objectFit: "cover",
              width: 32,
              height: 32,
              marginRight: 8,
            }}
          />
          GARF
        </span>
        <span className="gap-x-2 flex">
          <Upload
            beforeUpload={(_, fileList) => {
              setMeshFileList([...fileList]);
              return false;
            }}
            multiple
            maxCount={20}
            showUploadList={false}
            accept=".obj,.ply"
            disabled={assembling}
          >
            <Button icon={<CloudUploadOutlined />} disabled={assembling}>
              Upload
            </Button>
          </Upload>
          <Button
            icon={<ToolOutlined />}
            type="primary"
            onClick={() => {
              if (!assembleTask || assembling) {
                return;
              }
              setAssembling(true);
              assembleTask.startAssemble({
                ...assembleSettings,
                dataCollection: allowCollection ?? true,
              });
            }}
            loading={assembling}
            disabled={!assembleTask || assembling}
          >
            Assemble
          </Button>
        </span>
      </div>
      <Splitter layout={md ? "horizontal" : "vertical"} className="flex-1">
        <Splitter.Panel min={200} className="flex flex-col bg-[white] relative">
          <Spin
            fullscreen
            spinning={downloadingObjProgress !== undefined}
            tip={
              downloadingObjProgress &&
              (downloadingObjProgress.totalBytes > 0 ? (
                <div>
                  <div>Downloading meshes files from gallery...</div>
                  {/* convert to MB */}
                  <div>
                    {(
                      downloadingObjProgress.downloadedBytes /
                      1024 /
                      1024
                    ).toFixed(2)}{" "}
                    /{" "}
                    {(downloadingObjProgress.totalBytes / 1024 / 1024).toFixed(
                      2
                    )}{" "}
                    MB
                  </div>
                </div>
              ) : (
                "Fetching metadata from server"
              ))
            }
            wrapperClassName="ml-auto mr-auto"
          />
          {!assembleTask && (
            <div className="absolute flex-1 z-10 top-0 left-0 w-full h-full flex items-center justify-center">
              <div className="bg-white shadow-lg rounded-xl p-6 w-96 text-center">
                <Typography.Title level={4}>Get Started</Typography.Title>
                <Typography.Text type="secondary">
                  Upload mesh files or select samples from the gallery to begin
                  assembly.
                </Typography.Text>
                <div className="mt-4 flex gap-2 justify-center">
                  <Upload
                    beforeUpload={(_, fileList) => {
                      setMeshFileList([...fileList]);
                      return false;
                    }}
                    multiple
                    maxCount={20}
                    showUploadList={false}
                    accept=".obj,.ply"
                    disabled={assembling}
                  >
                    <Button
                      icon={<CloudUploadOutlined />}
                      disabled={assembling}
                    >
                      Upload
                    </Button>
                  </Upload>
                  <Button
                    type="primary"
                    onClick={() => setGalleryVisible(true)}
                  >
                    Open Gallery
                  </Button>
                </div>
              </div>
            </div>
          )}
          <AssemblyScene
            task={assembleTask}
            visualizationSettings={visualizationSettings}
          />
        </Splitter.Panel>
        <Splitter.Panel min={360} defaultSize={360}>
          <div className="p-2 h-full overflow-y-auto gap-4">
            <div>
              <h3 className="text-xl font-semibold mb-2">
                Visualization Settings
              </h3>
              <Form
                layout="horizontal"
                style={{ width: "100%" }}
                title="Configurations"
                initialValues={visualizationSettings}
                onValuesChange={(changedValues) => {
                  setVisualizationSettings((prev) => ({
                    ...prev,
                    ...changedValues,
                  }));
                }}
              >
                <Form.Item label="Mesh" name="showMesh">
                  <Switch style={{ float: "right" }} />
                </Form.Item>
                <Form.Item label="Point Cloud" name="showPointCloud">
                  <Switch style={{ float: "right" }} />
                </Form.Item>
                <Form.Item label="Fracture Surface" name="showFractureSurface">
                  <Switch style={{ float: "right" }} />
                </Form.Item>
                <Form.Item
                  label="Fracture Surface Offset"
                  name="fractureSurfaceOffset"
                >
                  <InputNumber
                    style={{ float: "right" }}
                    step={0.1}
                    min={0.0}
                    max={1.0}
                  />
                </Form.Item>
                <Form.Item label="Trail" name="showTrail">
                  <Switch style={{ float: "right" }} />
                </Form.Item>
              </Form>
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-2">Inference Settings</h3>
              <Form
                layout="horizontal"
                style={{ width: "100%" }}
                title="Configurations"
                initialValues={assembleSettings}
                onValuesChange={(changedValues) => {
                  setAssembleSettings((prev) => ({
                    ...prev,
                    ...changedValues,
                  }));
                }}
                disabled={assembling}
              >
                <Form.Item label="Seed" name="seed">
                  <InputNumber style={{ float: "right" }} placeholder="42" />
                </Form.Item>
                <Form.Item label="Steps" name="steps">
                  <InputNumber
                    min={1}
                    max={100}
                    style={{ float: "right" }}
                    placeholder="20"
                  />
                </Form.Item>
                <Form.Item label="Sample Points" name="samplePoints">
                  <InputNumber
                    style={{ float: "right" }}
                    placeholder="5000"
                    min={5000}
                  />
                </Form.Item>
                <Form.Item label="Max Iterations" name="maxIterations">
                  <InputNumber
                    style={{ float: "right" }}
                    placeholder="6"
                    min={1}
                  />
                </Form.Item>
                <Form.Item label="One Step Initialization" name="oneStepInit">
                  <Switch style={{ float: "right" }} />
                </Form.Item>
                <Form.Item label="Sample Strategy" name="sampleStrategy">
                  <Segmented
                    options={[
                      { value: "uniform", label: "Uniform" },
                      { value: "poisson", label: "Poisson" },
                    ]}
                    style={{ float: "right" }}
                    disabled={assembling}
                  />
                </Form.Item>
                {/* <Form.Item label="LoRA" name="loraCheckpoint">
                  <Select
                    options={loraOptions}
                    style={{ float: "right", width: 90 }}
                    disabled={assembling}
                    loading={loadingLoRA}
                  />
                </Form.Item>
                <Form.Item label="Checkpoint" name="ckpt">
                  <Select
                    options={checkpointOptions}
                    style={{ float: "right", width: 90 }}
                    disabled={assembling}
                    loading={loadingCheckpoint}
                  />
                </Form.Item> */}
              </Form>
            </div>
            <Input
              placeholder="Fracture Name"
              value={expName}
              onChange={(x) => setExpName(x.target.value)}
              addonAfter={
                <Typography.Link
                  onClick={() => {
                    const blob = assembleTask?.exportJson(expName);
                    if (blob) {
                      // save as file
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${expName}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                  }}
                  disabled={!assembleTask || assembling}
                >
                  Export
                </Typography.Link>
              }
            />
          </div>
        </Splitter.Panel>
      </Splitter>
      <Gallery
        galleryVisible={galleryVisible}
        setGalleryVisible={setGalleryVisible}
        assembleFromGallery={assembleFromGallery}
      />
    </div>
  );
};

export default App;
