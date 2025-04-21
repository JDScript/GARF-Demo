import * as THREE from "three";
import { FC, useEffect, useMemo, useRef } from "react";
import { AssembleTask } from "../../AssembleTask";

interface PointCloudProps {
  points: number[][];
  color: number;
  size?: number;
  offset_translation?: number[];
  axesSize?: number;
  showAxes?: boolean;
  arrowSize?: number;
  idx: number;
  taskEventEmitter: AssembleTask;
  baseTranslation?: number[];
}

const PointCloud: FC<PointCloudProps> = ({
  points,
  color,
  size = 0.01,
  axesSize = 0.2,
  showAxes = true,
  arrowSize = 0.02, // 箭头大小
  idx,
  taskEventEmitter,
  baseTranslation = [0, 0, 0],
}) => {
  const pointTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");

    if (context) {
      context.beginPath();
      context.arc(32, 32, 30, 0, 2 * Math.PI);
      context.fillStyle = "#ffffff";
      context.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }, []);

  const geometry = useMemo(() => {
    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points.flat(), 3)
    );
    bufferGeometry.computeBoundingBox();
    return bufferGeometry;
  }, [points]);

  const pointsRef = useRef<THREE.Points>(null);
  const groupRef = useRef<THREE.Group>(null);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: color,
        size: size,
        map: pointTexture,
        transparent: true,
        alphaTest: 0.5,
        sizeAttenuation: true,
      }),
    [color, size, pointTexture]
  );

  // 创建带箭头的坐标轴
  const customAxes = useMemo(() => {
    const axes = new THREE.Group();

    // 创建箭头
    const createArrow = (color: number, direction: THREE.Vector3) => {
      const group = new THREE.Group();

      // 创建轴线
      const lineGeometry = new THREE.BufferGeometry();
      const lineVertices = new Float32Array([
        0,
        0,
        0,
        direction.x * axesSize,
        direction.y * axesSize,
        direction.z * axesSize,
      ]);
      lineGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(lineVertices, 3)
      );
      const lineMaterial = new THREE.LineBasicMaterial({ color });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      group.add(line);

      // 创建箭头头部
      const coneGeometry = new THREE.ConeGeometry(arrowSize, arrowSize * 2, 8);
      const coneMaterial = new THREE.MeshBasicMaterial({ color });
      const cone = new THREE.Mesh(coneGeometry, coneMaterial);

      // 放置箭头头部
      cone.position.copy(direction.multiplyScalar(axesSize));

      // 调整箭头方向
      if (direction.x === axesSize) {
        cone.rotation.z = -Math.PI / 2;
      } else if (direction.z === axesSize) {
        cone.rotation.x = Math.PI / 2;
      }

      group.add(cone);
      return group;
    };

    // 创建三个轴
    const xArrow = createArrow(0xff0000, new THREE.Vector3(1, 0, 0));
    const yArrow = createArrow(0x00ff00, new THREE.Vector3(0, 1, 0));
    const zArrow = createArrow(0x0000ff, new THREE.Vector3(0, 0, 1));

    axes.add(xArrow, yArrow, zArrow);

    // 添加轴标签
    const createLabel = (
      text: string,
      position: THREE.Vector3,
      color: string
    ) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 1024;
      const context = canvas.getContext("2d");
      if (context) {
        context.font = "bold 100px Arial";
        context.fillStyle = color;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(text, 500, 500);
      }
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.copy(position);
      sprite.scale.set(0.5, 0.5, 0.5);
      return sprite;
    };

    // 添加 X、Y、Z 标签
    const labelOffset = axesSize + arrowSize * 2;
    axes.add(
      createLabel("X", new THREE.Vector3(labelOffset, 0, 0), "#ff0000"),
      createLabel("Y", new THREE.Vector3(0, labelOffset, 0), "#00ff00"),
      createLabel("Z", new THREE.Vector3(0, 0, labelOffset), "#0000ff")
    );

    return axes;
  }, [axesSize, arrowSize]);

  useEffect(() => {
    return () => {
      material.dispose();
      pointTexture.dispose();
      customAxes.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
        if (object instanceof THREE.Line) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
        if (object instanceof THREE.Sprite) {
          (object.material as THREE.SpriteMaterial).map?.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    };
  }, [material, pointTexture, customAxes]);

  useEffect(() => {
    const points = pointsRef.current;
    const group = groupRef.current;
    if (!points || !group) return;

    points.geometry = geometry;
    points.material = material;

    group.children = group.children.filter(
      (child) => child instanceof THREE.Points
    );

    if (showAxes) {
      if (geometry.boundingBox) {
        const center = new THREE.Vector3();
        geometry.boundingBox.getCenter(center);
        customAxes.position.copy(center);
      }
      group.add(customAxes);
    }
  }, [material, geometry, showAxes, customAxes]);

  useEffect(() => {
    const onStep = (stepIdx?: number) => {
      if (groupRef.current) {
        const transformation = taskEventEmitter.getTransformation(idx, stepIdx);
        groupRef.current.position.set(
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
        groupRef.current.quaternion.copy(quat);
      }
    };

    // Initial position
    onStep();

    taskEventEmitter.on("step", onStep);
    return () => {
      taskEventEmitter.off("step", onStep);
    };
  }, [taskEventEmitter, idx, baseTranslation]);

  return (
    <group ref={groupRef}>
      <points ref={pointsRef} />
    </group>
  );
};

export default PointCloud;
