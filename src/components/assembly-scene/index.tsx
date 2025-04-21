import { PresentationControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { AssembleTask, Vec3 } from "../../AssembleTask";
import { useEffect, useMemo, useState } from "react";
import Model3D from "../model3d";
import PointCloud from "../pointcloud";
import { Slider } from "antd";

const AssemblyScene = ({
  task,
  visualizationSettings = {
    showMesh: true,
    showPointCloud: false,
    showFractureSurface: false,
    fractureSurfaceOffset: 0.5,
    showTrail: true,
  },
}: {
  task?: AssembleTask;
  visualizationSettings?: {
    showMesh: boolean;
    showPointCloud: boolean;
    showFractureSurface: boolean;
    fractureSurfaceOffset: number;
    showTrail: boolean;
  };
}) => {
  const meshes = useMemo(
    () => task?.meshesList.map((_, index) => task.getMesh(index)),
    [task]
  );

  const [pointClouds, setPointClouds] = useState<Vec3[][]>([]);
  const [fractureSurfaces, setFractureSurfaces] = useState<Vec3[][]>([]);
  const [currentStep, setCurrentStep] = useState<number>();
  const [totalSteps, setTotalSteps] = useState<number>();

  useEffect(() => {
    const onStep = (step: number, totalSteps: number) => {
      setCurrentStep(step);
      setTotalSteps(totalSteps);
    };

    if (task) {
      task.on("step", onStep);
      task.on("recvPointClouds", setPointClouds);
      task.on("recvFractureSurfaces", setFractureSurfaces);
    }

    return () => {
      if (task) {
        task.off("step", onStep);
        task.off("recvPointClouds", setPointClouds);
        task.off("recvFractureSurfaces", setFractureSurfaces);
        setCurrentStep(undefined);
        setTotalSteps(undefined);
        setPointClouds([]);
        setFractureSurfaces([]);
      }
    };
  }, [task]);

  return (
    <>
      <Canvas
        className="flex-1"
        camera={{
          position: [0, -4, 1.5],
          near: 0.1,
          far: 1000,
          castShadow: true,
          fov: 40,
        }}
        shadows="soft"
      >
        {/* All Lights */}
        <ambientLight intensity={1} />
        <spotLight
          position={[2.83, -3, 4.01]}
          power={600}
          angle={(Math.PI * 70) / 180}
          castShadow={true}
          shadow-mapSize-height={4096}
          shadow-mapSize-width={4096}
          shadow-opacity={0.1}
          shadow-bias={0.001}
        />
        <pointLight position={[-3.31, 3.6, 4.38]} power={150} />
        <rectAreaLight
          position={[-4.3, -3.4, 2.7]}
          power={500}
          width={10}
          height={10}
        />

        <mesh receiveShadow position={[0, 4, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color={0x808080} />
        </mesh>
        <mesh receiveShadow position={[0, 0, -1.5]}>
          <planeGeometry args={[20, 20]} />
          <meshLambertMaterial color={0x808080} />
        </mesh>

        <PresentationControls
          global
          speed={2}
          polar={[-Infinity, Infinity]}
          azimuth={[-Infinity, Infinity]}
        >
          {visualizationSettings.showMesh &&
            meshes?.map((mesh, idx) => (
              <Model3D
                key={idx}
                {...mesh}
                baseTranslation={
                  visualizationSettings.showFractureSurface
                    ? [-visualizationSettings.fractureSurfaceOffset, 0, 0]
                    : [0, 0, 0]
                }
                showTrail={visualizationSettings.showTrail}
              />
            ))}

          {visualizationSettings.showPointCloud &&
            meshes &&
            meshes.length === pointClouds.length &&
            pointClouds.map((pointCloud, idx) => (
              <PointCloud
                key={idx}
                points={pointCloud}
                idx={idx}
                color={meshes[idx].color}
                taskEventEmitter={meshes[idx].taskEventEmitter}
                showAxes={false}
                baseTranslation={
                  visualizationSettings.showFractureSurface
                    ? [-visualizationSettings.fractureSurfaceOffset, 0, 0]
                    : [0, 0, 0]
                }
              />
            ))}

          {visualizationSettings.showFractureSurface &&
            meshes &&
            meshes.length === fractureSurfaces.length &&
            fractureSurfaces.map((fractureSurface, idx) => (
              <PointCloud
                key={idx}
                points={fractureSurface}
                idx={idx}
                color={meshes[idx].color}
                taskEventEmitter={meshes[idx].taskEventEmitter}
                showAxes={false}
                size={0.02}
                baseTranslation={
                  visualizationSettings.showFractureSurface
                    ? [visualizationSettings.fractureSurfaceOffset, 0, 0]
                    : [0, 0, 0]
                }
              />
            ))}
        </PresentationControls>
      </Canvas>
      <div className="flex h-12 items-center border-t-gray-200 border-t-2 px-2 gap-2">
        <Slider
          className="w-full"
          value={currentStep}
          min={-2}
          max={totalSteps}
          disabled={currentStep === undefined || totalSteps === undefined}
          onChange={(value) => {
            if (task) {
              task.currentStep = value;
            }
          }}
          tooltip={{
            formatter(value) {
              if (value === -2) {
                return "Your Input";
              }

              if (value === -1) {
                return "Model Input";
              }

              if (value === 0) {
                return "Noise";
              }

              if (value === totalSteps) {
                return "End";
              }
              return value;
            },
            placement: "topRight",
          }}
        />
        <span className="text-nowrap">{`${
          currentStep === undefined ? "-" : Math.max(currentStep, 0)
        } / ${totalSteps === undefined ? "-" : totalSteps}`}</span>
      </div>
    </>
  );
};

export default AssemblyScene;
