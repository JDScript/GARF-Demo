import { createContext, useContext } from "react";
import { Client } from "@gradio/client";

interface IAppContext {
  gradio?: Client;
}

export const AppContext = createContext<IAppContext>({});

export const useGradioClient = () => {
  const context = useContext(AppContext);
  if (!context || !context.gradio) {
    throw new Error("useGradioClient must be used within a AppProvider");
  }

  return context.gradio;
};
