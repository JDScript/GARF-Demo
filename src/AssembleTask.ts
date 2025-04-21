import { EventEmitter } from "eventemitter3";
import { Client as GradioClient } from "@gradio/client";
import * as THREE from "three";

const COLORS = [
  0xfe8a18, 0xc91a09, 0x237841, 0x0055bf, 0xf2705e, 0xfc97ac, 0x4b9f4a,
  0x008f9b, 0xf5cd2f, 0x4354a3,
];

export type AssembleSettings = {
  samplePoints: number;
  steps: number;
  seed: number;
  maxIterations: number;
  oneStepInit: boolean;
  sampleStrategy: "uniform" | "poisson";
  loraCheckpoint?: string;
  ckpt?: string;
  dataCollection: boolean;
};

export enum AssembleStatus {
  INIT = "INIT",
  REQUESTED = "REQUESTED",
  QUEUED = "QUEUED",
  PROGRESSING = "PROGRESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export type AssembleTaskEvent = {
  step: [stepIdx: number, totalSteps: number];
  statusUpdate:
    | [
        status:
          | AssembleStatus.INIT
          | AssembleStatus.REQUESTED
          | AssembleStatus.QUEUED
          | AssembleStatus.COMPLETED
          | AssembleStatus.FAILED
      ]
    | [status: AssembleStatus.PROGRESSING, step: number, totalSteps: number];
  meshScale: [scale: number];
  recvPointClouds: [pointClouds: Vec3[][]];
  recvFractureSurfaces: [fractureSurfaces: Vec3[][]];
  recvMetrics: [
    metrics: {
      [key: string]: number;
    }
  ];
};

export type Vec3 = [x: number, y: number, z: number];
export type Quat = [w: number, x: number, y: number, z: number];

class Transformation {
  constructor(public translation: Vec3, public quaternion: Quat) {}

  private multiplyQuaternions(q1: Quat, q2: Quat): Quat {
    const [w1, x1, y1, z1] = q1;
    const [w2, x2, y2, z2] = q2;

    return [
      w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
      w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
      w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
      w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    ];
  }

  private rotateVector(q: Quat, v: Vec3): Vec3 {
    const [vx, vy, vz] = v;
    const qConjugate: Quat = [q[0], -q[1], -q[2], -q[3]];
    const vQuat: Quat = [0, vx, vy, vz];

    const rotatedQuat = this.multiplyQuaternions(
      this.multiplyQuaternions(q, vQuat),
      qConjugate
    );
    return [rotatedQuat[1], rotatedQuat[2], rotatedQuat[3]];
  }

  inverse(): Transformation {
    const qConjugate: Quat = [
      this.quaternion[0],
      -this.quaternion[1],
      -this.quaternion[2],
      -this.quaternion[3],
    ];

    const rotatedTranslation = this.rotateVector(qConjugate, this.translation);
    const newTranslation: Vec3 = [
      -rotatedTranslation[0],
      -rotatedTranslation[1],
      -rotatedTranslation[2],
    ];

    return new Transformation(newTranslation, qConjugate);
  }

  applyTransformation(transformation: Transformation): Transformation {
    const newQuaternion = this.multiplyQuaternions(
      this.quaternion,
      transformation.quaternion
    );

    const rotatedTranslation = this.rotateVector(
      this.quaternion,
      transformation.translation
    );
    const newTranslation: Vec3 = [
      this.translation[0] + rotatedTranslation[0],
      this.translation[1] + rotatedTranslation[1],
      this.translation[2] + rotatedTranslation[2],
    ];

    return new Transformation(newTranslation, newQuaternion);
  }
}

type AssembleMeshScaleMsg = {
  type: "mesh_scale";
  data: number;
};

type AssembleInputMsg = {
  type: "input";
  data: {
    pointclouds: Vec3[][];
    initial_translation: Vec3[];
    initial_rotation: Quat[];
  };
};

type AssembleFractureSegmentationMsg = {
  type: "fracture_segmentation";
  data: Vec3[][];
};

type AssembleTransformationMsg = {
  type: "transformation";
  data: {
    translation: Vec3[];
    rotation: Quat[];
    step: number;
    iter: number;
  };
};

type AssembleMetricsMsg = {
  type: "metrics";
  data: {
    [key: string]: number;
  };
};

type AssembleMsg =
  | AssembleMeshScaleMsg
  | AssembleInputMsg
  | AssembleFractureSegmentationMsg
  | AssembleTransformationMsg
  | AssembleMetricsMsg;

export class AssembleTask extends EventEmitter<AssembleTaskEvent> {
  private readonly meshType: string;
  private status: AssembleStatus = AssembleStatus.INIT;
  private initial_transformations: Transformation[] = [];
  private originalTransformations: Transformation[][] = [];
  private transformations: Transformation[][] = [];
  private pointClouds: Vec3[][] = [];
  private fractureSurfaces: Vec3[][] = [];
  private _currentStep: number = -2;
  private _totalSteps: number = 0;
  private _meshObj: (THREE.Group | THREE.BufferGeometry | null)[] = [];
  public meshScale: number = 1;
  public pieces: string[] = [];

  constructor(
    private readonly gradioClient: GradioClient,
    private readonly meshesFile: File[],
    private readonly meshesFilePathOnServer: string[] = []
  ) {
    super();

    if (this.meshesFile.length < 2) {
      throw new Error("At least two meshes are required");
    }

    // ensure all meshes are of the same type
    this.meshType = this.meshesFile[0].name.split(".").slice(-1)[0];

    // only support .obj and .ply files
    if (!["obj", "ply"].includes(this.meshType)) {
      throw new Error("Only .obj and .ply files are supported");
    }

    if (
      !this.meshesFile.every((meshesFile) =>
        meshesFile.name.endsWith(this.meshType)
      )
    ) {
      throw new Error("All meshes must be of the same type");
    }

    this._meshObj = Array(this.meshesFile.length).fill(null);
    this.pieces = this.meshesFile.map((meshFile) => meshFile.name);
  }

  async startAssemble(settings: AssembleSettings) {
    if (
      this.status == AssembleStatus.REQUESTED ||
      this.status == AssembleStatus.QUEUED ||
      this.status == AssembleStatus.PROGRESSING
    ) {
      throw new Error("Task has already started");
    }

    if (!settings.loraCheckpoint) {
      delete settings.loraCheckpoint;
    }

    if (!settings.ckpt) {
      delete settings.ckpt;
    }

    this.status = AssembleStatus.REQUESTED;
    this.transformations = [];
    this.originalTransformations = [];
    this.initial_transformations = [];
    this._currentStep = -2;
    this._totalSteps =
      settings.steps * settings.maxIterations + (settings.oneStepInit ? 1 : 0);
    this.emit("statusUpdate", AssembleStatus.REQUESTED);
    this.emit("step", -2, this._totalSteps);

    let submission;

    if (this.meshesFilePathOnServer.length === this.meshesFile.length) {
      submission = this.gradioClient.submit("/inference", [
        undefined,
        this.meshesFilePathOnServer,
        this.meshType,
        settings,
      ]);
    } else {
      submission = this.gradioClient.submit("/inference", [
        this.meshesFile,
        [],
        this.meshType,
        settings,
      ]);
    }

    for await (const msg of submission) {
      switch (msg.type) {
        case "status": {
          if (msg.stage == "pending") {
            this.status = AssembleStatus.QUEUED;
            this.emit("statusUpdate", AssembleStatus.QUEUED);
          }

          if (msg.stage == "generating") {
            this.status = AssembleStatus.PROGRESSING;
            this.emit(
              "statusUpdate",
              AssembleStatus.PROGRESSING,
              this.currentStep + 1,
              this._totalSteps
            );
          }

          if (msg.stage == "error") {
            this.status = AssembleStatus.FAILED;
            this.emit("statusUpdate", AssembleStatus.FAILED);
          }

          if (msg.stage == "complete") {
            this.status = AssembleStatus.COMPLETED;
            this.emit("statusUpdate", AssembleStatus.COMPLETED);
          }
          break;
        }
        case "data": {
          const data = msg.data[0] as AssembleMsg;
          switch (data.type) {
            case "mesh_scale": {
              if (data.data !== this.meshScale) {
                this.meshScale = data.data;
                this.emit("meshScale", data.data);
              }
              break;
            }
            case "input": {
              this.initial_transformations = data.data.initial_translation.map(
                (trans, idx) =>
                  new Transformation(trans, data.data.initial_rotation[idx])
              );
              this.pointClouds = data.data.pointclouds;
              this.emit("recvPointClouds", data.data.pointclouds);
              this._currentStep = -1;
              this.emit("step", -1, this._totalSteps);
              break;
            }
            case "fracture_segmentation": {
              if (this.transformations.length <= 5) {
                this.fractureSurfaces = data.data;
                this.emit("recvFractureSurfaces", data.data);
              }
              break;
            }
            case "transformation": {
              const transformation = data.data.translation.map((trans, idx) => {
                return new Transformation(
                  trans,
                  data.data.rotation[idx]
                ).applyTransformation(
                  this.initial_transformations[idx].inverse()
                );
              });

              const originalTransformation = data.data.translation.map(
                (trans, idx) => {
                  return new Transformation(trans, data.data.rotation[idx]);
                }
              );

              this.transformations.push(transformation);
              this.originalTransformations.push(originalTransformation);
              this._currentStep = this.transformations.length - 1;
              this.emit(
                "step",
                this.transformations.length - 1,
                this._totalSteps
              );
              break;
            }
            case "metrics": {
              this.emit("recvMetrics", data.data);
              break;
            }
          }
          break;
        }
        case "log": {
          break;
        }
      }
    }
  }

  get meshesList() {
    return this.meshesFile;
  }

  get currentStep() {
    return this._currentStep;
  }

  set currentStep(step: number) {
    if (step < -2 || step >= this.transformations.length) {
      throw new Error("Invalid step index");
    }

    this._currentStep = step;
    this.emit("step", step, this._totalSteps);
  }

  getMesh(index: number) {
    return {
      url: URL.createObjectURL(this.meshesFile[index]),
      color: COLORS[index % COLORS.length],
      meshType: this.meshType as "obj" | "ply",
      idx: index,
      taskEventEmitter: this,
    };
  }

  getFractureSurface(index: number) {
    return this.fractureSurfaces[index] ?? [];
  }

  getPointCloud(index: number) {
    return this.pointClouds[index] ?? [];
  }

  // -2: User's input
  // -1: Initial transformation
  // 0: Noise, 1~n: n-th step
  getTransformation(index: number, step?: number) {
    if (step === undefined) {
      step = this.currentStep;
    }

    // User's input, without any transformation
    if (step === -2) {
      return new Transformation([0, 0, 0], [1, 0, 0, 0]);
    }

    // Initial transformation
    if (step === -1) {
      return this.initial_transformations[index].inverse();
    }

    return this.transformations[step][index];
  }

  getTransformations(index: number) {
    return this.transformations.map((transformation) => transformation[index]);
  }

  setObject(index: number, obj: THREE.Group | THREE.BufferGeometry) {
    this._meshObj[index] = obj;

    if (this._meshObj.every((obj) => obj !== null)) {
      let maxSize = 1.0;
      for (let i = 0; i < this._meshObj.length; i++) {
        const obj = this._meshObj[i];
        if (obj instanceof THREE.Group) {
          const boundingBox = new THREE.Box3().setFromObject(obj);
          const size = new THREE.Vector3();
          boundingBox.getSize(size);
          maxSize = Math.max(maxSize, Math.max(size.x, size.y, size.z));
        } else if (obj instanceof THREE.BufferGeometry) {
          const boundingBox = new THREE.Box3().setFromBufferAttribute(
            obj.getAttribute("position") as THREE.BufferAttribute
          );
          const size = new THREE.Vector3();
          boundingBox.getSize(size);
          maxSize = Math.max(maxSize, Math.max(size.x, size.y, size.z));
        }
      }

      this.meshScale = maxSize;
      this.emit("meshScale", this.meshScale);
    }
  }

  exportJson(name: string) {
    const data = {
      name: name,
      num_parts: this.meshesFile.length,
      gt_trans_rots: this.initial_transformations.map((trans) => [
        ...trans.translation,
        ...trans.quaternion,
      ]),
      pred_trans_rots: this.originalTransformations.map((allPartTrans) =>
        allPartTrans.map((trans) => [...trans.translation, ...trans.quaternion])
      ),
      removal_pieces: "",
      redundant_pieces: "",
      pieces: this.pieces.join(","),
      mesh_scale: this.meshScale,
      pointclouds: this.pointClouds,
    };

    return new Blob([JSON.stringify(data)], { type: "application/json" });
  }
}
