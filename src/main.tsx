import "./global.css";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { Client } from "@gradio/client";
import { AppContext } from "./context.ts";
import { useRequest } from "ahooks";
import { Button, ConfigProvider, Result, Spin, App as AntdApp } from "antd";
import { LoadingOutlined } from "@ant-design/icons";

// eslint-disable-next-line react-refresh/only-export-components
const AppProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const {
    data: gradio,
    loading: loading,
    error,
    refresh,
  } = useRequest(
    async () =>
      await Client.connect("https://garf-api.jdscript.app", {
        events: ["data", "status", "log"],
      })
  );

  if (error) {
    return (
      <div className="w-full h-full flex flex-col gap-4 items-center justify-center">
        <Result
          status="error"
          title="Error while connecting to the inference backend"
          subTitle={error.message}
          extra={
            <Button loading={loading} onClick={refresh}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col gap-4 items-center justify-center text-center">
        <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} />
        Connecting to the inference backend...
      </div>
    );
  }

  return (
    <AppContext.Provider
      value={{
        gradio,
      }}
    >
      <AntdApp className="h-full w-full">{children}</AntdApp>
    </AppContext.Provider>
  );
};

createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    theme={{
      token: {
        colorPrimary: "#fa8c16",
        colorLink: "#fa8c16",
        colorInfo: "#fa8c16",
      },
      components: {
        Form: {
          itemMarginBottom: 8,
        },
      },
    }}
  >
    <AppProvider>
      <App />
    </AppProvider>
  </ConfigProvider>
);
