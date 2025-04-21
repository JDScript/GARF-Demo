import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import { FC, useEffect, useRef, useMemo, useState, useCallback } from "react";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { AssembleTask } from "../../AssembleTask";
import { Line } from "@react-three/drei";

interface Model3DProps {
  url: string;
  color: number;
  // 四元数表示旋转
  quaternion?: number[];
  // 位移向量
  translation?: number[];
  meshType?: "obj" | "ply";
  offset_translation?: number[];
  scale?: number;
  idx: number;
  taskEventEmitter: AssembleTask;
  baseTranslation?: number[];
  showTrail?: boolean;
}

const Model3D: FC<Model3DProps> = ({
  url,
  color,
  meshType = "obj",
  idx,
  taskEventEmitter,
  baseTranslation = [0, 0, 0],
  showTrail = false,
}) => {
  const obj = useLoader(meshType === "obj" ? OBJLoader : PLYLoader, url);
  const meshRef = useRef<THREE.Mesh>(null);
  const [trailPoints, setTrailPoints] = useState<
    (readonly [number, number, number])[]
  >([]);
  const material = useMemo(() => {
    const hasColorAttribute =
      obj instanceof THREE.BufferGeometry &&
      obj.getAttribute("color") !== undefined;
    return new THREE.MeshPhysicalMaterial({
      vertexColors: hasColorAttribute,
      color: hasColorAttribute ? undefined : color,
      roughness: 0.35,
      metalness: 0.0,
      flatShading: true,
      ior: 1.5,
    });
  }, [obj, color]);

  const centroid = useMemo(() => {
    const computeCentroidFromBoundingBox = (geometry: THREE.BufferGeometry) => {
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox(); // 确保包围盒已计算
      }
      const center = new THREE.Vector3();
      geometry.boundingBox?.getCenter(center);
      return center;
    };

    if (obj && obj instanceof THREE.Group) {
      const totalBBox = new THREE.Box3();

      // 遍历所有子对象并合并包围盒
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry) {
          const geometry = child.geometry;
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          totalBBox.union(geometry.boundingBox); // 合并包围盒
        }
      });

      if (!totalBBox.isEmpty()) {
        const center = new THREE.Vector3();
        totalBBox.getCenter(center);
        return center;
      }
    } else if (meshType === "ply" && meshRef.current?.geometry) {
      const geometry = meshRef.current.geometry;
      return computeCentroidFromBoundingBox(geometry);
    }

    // 默认回退到原点
    return new THREE.Vector3();
  }, [obj, meshType]);

  const updateTrailPoints = useCallback(() => {
    // Get current step
    const stepIdx = taskEventEmitter.currentStep;
    const transformation = taskEventEmitter.getTransformations(idx);
    // Calculate all points using centroid
    const points = transformation.slice(0, Math.abs(stepIdx + 1)).map((t) => {
      const quat = new THREE.Quaternion(
        t.quaternion[1],
        t.quaternion[2],
        t.quaternion[3],
        t.quaternion[0]
      );
      const translation = new THREE.Vector3(
        t.translation[0] + baseTranslation[0],
        t.translation[1] + baseTranslation[1],
        t.translation[2] + baseTranslation[2]
      );
      const pos = centroid.clone().applyQuaternion(quat).add(translation);
      return [pos.x, pos.y, pos.z] as const;
    });

    // Update trail points
    setTrailPoints(points);
  }, [taskEventEmitter, idx, centroid, baseTranslation]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useEffect(() => {
    if (obj && obj instanceof THREE.Group && meshRef.current) {
      const mesh = obj.children.find((child) => child instanceof THREE.Mesh) as
        | THREE.Mesh
        | undefined;

      if (mesh) {
        meshRef.current.geometry = mesh.geometry;
        meshRef.current.material = material; // 可能也要同步材质
      }
    } else if (meshType === "ply" && meshRef.current) {
      // For PLY, we need to set the geometry directly
      meshRef.current.geometry = obj as THREE.BufferGeometry;
      meshRef.current.material = material;
    }
  }, [obj, material, meshType]);

  useEffect(() => {
    const onStep = (stepIdx?: number) => {
      if (meshRef.current) {
        const transformation = taskEventEmitter.getTransformation(idx, stepIdx);
        meshRef.current.position.set(
          transformation.translation[0] + baseTranslation[0],
          transformation.translation[1] + baseTranslation[1],
          transformation.translation[2] + baseTranslation[2]
        );
        const quat = new THREE.Quaternion(
          transformation.quaternion[1],
          transformation.quaternion[2],
          transformation.quaternion[3],
          transformation.quaternion[0]
        );
        meshRef.current.quaternion.copy(quat);

        updateTrailPoints();
      }
    };
    const onScale = (scale: number) => {
      if (meshRef.current) {
        meshRef.current.scale.set(1 / scale, 1 / scale, 1 / scale);
      }
    };

    // Initial position
    onStep();
    onScale(taskEventEmitter.meshScale);

    taskEventEmitter.on("step", onStep);
    taskEventEmitter.on("meshScale", onScale);
    return () => {
      taskEventEmitter.off("step", onStep);
      taskEventEmitter.off("meshScale", onScale);
    };
  }, [taskEventEmitter, idx, baseTranslation, updateTrailPoints]);

  useEffect(() => {
    taskEventEmitter.setObject(idx, obj);
  }, [obj, taskEventEmitter, idx]);

  return (
    <>
      <mesh ref={meshRef} castShadow={true} position={[0, 0, 0]} />
      {trailPoints.length > 1 && showTrail && (
        <>
          <Line
            points={trailPoints}
            color={color}
            lineWidth={2}
            transparent
            opacity={0.5}
          />
          {trailPoints.map((point, idx) => (
            <mesh position={point} key={idx}>
              <sphereGeometry args={[0.01, 16, 16]} />
              <meshStandardMaterial color={color} depthWrite={false} />
            </mesh>
          ))}
        </>
      )}
    </>
  );
};

export default Model3D;
